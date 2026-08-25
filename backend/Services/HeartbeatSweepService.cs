using Microsoft.AspNetCore.SignalR;
using backend.Hubs;

namespace backend.Services;

/// <summary>
/// Worker de background que varre as conexões SignalR periodicamente.
/// Se um cliente parar de responder ao Heartbeat/Ping por mais de 10 segundos,
/// executa a limpeza forçada e notifica os demais membros imediatamente.
/// </summary>
public class HeartbeatSweepService : BackgroundService
{
    private readonly IHubContext<CallHub> _hubContext;
    private readonly ILogger<HeartbeatSweepService> _logger;
    private readonly TimeSpan _checkInterval = TimeSpan.FromSeconds(3);
    private readonly TimeSpan _timeoutThreshold = TimeSpan.FromSeconds(10);

    public HeartbeatSweepService(IHubContext<CallHub> hubContext, ILogger<HeartbeatSweepService> logger)
    {
        _hubContext = hubContext;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("[Heartbeat 🟢] HeartbeatSweepService iniciado (Intervalo: {Interval}s, Timeout: {Timeout}s).",
            _checkInterval.TotalSeconds, _timeoutThreshold.TotalSeconds);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(_checkInterval, stoppingToken);
                await CallHub.SweepDeadConnectionsAsync(_hubContext, _timeoutThreshold, _logger);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "[Heartbeat 🔴] Erro ao executar a varredura de conexões inativas.");
            }
        }
    }
}
