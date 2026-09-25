using System.Net.Http.Headers;
using System.Text.Json;
using backend.Hubs;
using backend.Services;

// Desativa inotify FileSystemWatcher para rodar em containers compartilhados no Render/Linux
Environment.SetEnvironmentVariable("DOTNET_USE_POLLING_FILE_WATCHER", "1");
Environment.SetEnvironmentVariable("DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE", "false");

var builder = WebApplication.CreateBuilder(args);

// Google Cloud Run injeta a variável PORT; fallback para 8080 em ambiente local
var port = Environment.GetEnvironmentVariable("PORT") ?? "8080";
builder.WebHost.UseUrls($"http://*:{port}");

builder.Services.AddSignalR();
builder.Services.AddHostedService<HeartbeatSweepService>();
builder.Services.AddHttpClient("Twilio");

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", policy =>
    {
        policy.AllowAnyHeader()
              .AllowAnyMethod()
              .SetIsOriginAllowed((host) => true)
              .AllowCredentials();
    });
});

var app = builder.Build();

app.UseCors("AllowAll");

app.MapGet("/", () => "CuiCall Signaling Server Online");
app.MapHub<CallHub>("/callHub");

// ═══════ ICE Servers (Twilio TURN + fallback STUN) ═══════
app.MapGet("/api/ice-servers", async (IConfiguration config, IHttpClientFactory httpFactory, ILogger<Program> logger) =>
{
    // Fallback: servidores STUN públicos do Google
    var fallbackServers = new[]
    {
        new { urls = "stun:stun.l.google.com:19302" },
        new { urls = "stun:stun1.l.google.com:19302" }
    };

    var accountSid = config["Twilio:AccountSid"] ?? Environment.GetEnvironmentVariable("Twilio__AccountSid");
    var authToken  = config["Twilio:AuthToken"]  ?? Environment.GetEnvironmentVariable("Twilio__AuthToken");

    if (string.IsNullOrEmpty(accountSid) || string.IsNullOrEmpty(authToken))
    {
        logger.LogWarning("[ICE] Credenciais Twilio não configuradas. Retornando apenas STUN públicos.");
        return Results.Ok(new { iceServers = fallbackServers });
    }

    try
    {
        var client = httpFactory.CreateClient("Twilio");
        var credentials = Convert.ToBase64String(
            System.Text.Encoding.ASCII.GetBytes($"{accountSid}:{authToken}"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", credentials);

        var response = await client.PostAsync(
            $"https://api.twilio.com/2010-04-01/Accounts/{accountSid}/Tokens.json",
            new FormUrlEncodedContent(Array.Empty<KeyValuePair<string, string>>()));

        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadFromJsonAsync<JsonElement>();
        var iceServers = json.GetProperty("ice_servers");

        logger.LogInformation("[ICE] Credenciais TURN Twilio geradas com sucesso ({Count} servers).", iceServers.GetArrayLength());
        return Results.Ok(new { iceServers });
    }
    catch (Exception ex)
    {
        logger.LogError(ex, "[ICE] Falha ao obter credenciais TURN da Twilio. Retornando STUN fallback.");
        return Results.Ok(new { iceServers = fallbackServers });
    }
});

app.Run();
