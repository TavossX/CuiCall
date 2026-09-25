# ============================================================
# Dockerfile — CuiCall Signaling Server (Google Cloud Run)
# Build context: ./backend
# ============================================================

# ---------- Etapa 1: Build ----------
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Copia apenas o .csproj primeiro para aproveitar o cache de camadas do Docker
COPY backend.csproj ./
RUN dotnet restore backend.csproj

# Copia o restante do código-fonte e publica em modo Release
COPY . ./
RUN dotnet publish -c Release -o /app/publish /p:UseAppHost=false

# ---------- Etapa 2: Runtime ----------
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

# --- Variáveis de Ambiente ---
# PORT é injetada pelo Cloud Run em tempo de execução (padrão 8080)
ENV PORT=8080
ENV ASPNETCORE_ENVIRONMENT=Production

# Otimizações para containers serverless
ENV DOTNET_EnableDiagnostics=0
ENV DOTNET_gcServer=0
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1
ENV DOTNET_USE_POLLING_FILE_WATCHER=true
ENV DOTNET_HOSTBUILDER__RELOADCONFIGONCHANGE=false

EXPOSE 8080

ENTRYPOINT ["dotnet", "backend.dll"]
