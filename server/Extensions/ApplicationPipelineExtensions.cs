using LShopOzonWebReact.Api.Configuration;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Hubs;
using LShopOzonWebReact.Api.Integrations;
using LShopOzonWebReact.Api.Marketplaces;
using LShopOzonWebReact.Api.Ozon;
using LShopOzonWebReact.Api.Production;
using LShopOzonWebReact.Api.Security;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace LShopOzonWebReact.Api.Extensions;

public static class ApplicationPipelineExtensions
{
    public static async Task InitializeApplicationAsync(this WebApplication app)
    {
        var databaseOptions = app.Services.GetRequiredService<IOptions<DatabaseOptions>>().Value;

        if (databaseOptions.ApplyMigrationsOnStartup)
        {
            using var scope = app.Services.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Database.Migrate();
            await SystemUserBootstrap.EnsureExistsAsync(db);
            await RoleProfilesBootstrap.EnsureDefaultsAsync(db);
            await ProductionAnalyticsStore.BackfillMissingRecordsAsync(db);
            var credentials = scope.ServiceProvider.GetRequiredService<OzonRuntimeCredentials>();
            await credentials.LoadFromDatabaseAsync(db);
        }
        else
        {
            using var scope = app.Services.CreateScope();
            var credentials = scope.ServiceProvider.GetRequiredService<OzonRuntimeCredentials>();
            await credentials.LoadFromDatabaseAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>());
        }
    }

    public static WebApplication UseApplicationPipeline(this WebApplication app)
    {
        var hasStaticClient = !string.IsNullOrWhiteSpace(app.Environment.WebRootPath)
            && Directory.Exists(app.Environment.WebRootPath);

        if (app.Environment.IsDevelopment())
        {
            app.MapOpenApi();
        }

        app.UseForwardedHeaders();

        var httpsOptions = app.Services.GetRequiredService<IOptions<HttpsOptions>>().Value;
        if (app.Environment.IsDevelopment() || httpsOptions.UseRedirection)
        {
            app.UseHttpsRedirection();
        }

        if (hasStaticClient)
        {
            app.UseDefaultFiles();
            app.UseStaticFiles();
        }

        app.UseCors("ReactDev");
        app.UseAuthentication();
        app.UseAuthorization();

        app.MapHub<AppHub>("/hubs/live").RequireAuthorization();
        app.MapIntegrationRoutes();
        app.MapKzMarketplaceRoutes();

        return app;
    }
}
