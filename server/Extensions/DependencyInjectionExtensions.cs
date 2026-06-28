using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using LShopOzonWebReact.Api.Configuration;
using LShopOzonWebReact.Api.Data;
using LShopOzonWebReact.Api.Integrations;
using LShopOzonWebReact.Api.Marketplaces;
using LShopOzonWebReact.Api.Ozon;
using LShopOzonWebReact.Api.Security;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace LShopOzonWebReact.Api.Extensions;

public static class DependencyInjectionExtensions
{
    public static IServiceCollection AddApplicationServices(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOpenApi();
        services.AddMemoryCache();
        services.AddSingleton<SatuCatalogCache>();
        services.AddHostedService<SatuCatalogWarmupHostedService>();
        services.AddDbContext<AppDbContext>(options =>
            options.UseNpgsql(configuration.GetConnectionString("Postgres")));

        services.Configure<OzonOptions>(configuration.GetSection("Ozon"));
        services.Configure<TelegramOptions>(configuration.GetSection("Telegram"));
        services.Configure<JwtOptions>(configuration.GetSection(JwtOptions.SectionName));
        services.Configure<DatabaseOptions>(configuration.GetSection(DatabaseOptions.SectionName));
        services.Configure<HttpsOptions>(configuration.GetSection(HttpsOptions.SectionName));
        services.Configure<AdminOptions>(configuration.GetSection(AdminOptions.SectionName));

        services.AddSingleton<OzonRuntimeCredentials>();
        services.AddSingleton<KzMarketplaceCredentials>();
        services.AddHttpClient<KzMarketplaceApiClient>(client =>
        {
            client.Timeout = TimeSpan.FromMinutes(15);
        });
        services.AddHttpClient(nameof(TelegramNotificationService));
        services.AddHttpClient(nameof(TelegramBotHostedService));
        services.AddSingleton<TelegramNotificationService>();
        services.AddScoped<DailyReportService>();
        services.AddHostedService<TelegramBotHostedService>();
        services.AddHostedService<DailyReportHostedService>();
        services.AddHttpClient<OzonApiClient>((serviceProvider, client) =>
        {
            var credentials = serviceProvider.GetRequiredService<OzonRuntimeCredentials>();
            client.BaseAddress = new Uri(string.IsNullOrWhiteSpace(credentials.BaseUrl)
                ? "https://api-seller.ozon.ru"
                : credentials.BaseUrl);
            client.Timeout = TimeSpan.FromMinutes(3);
        });
        services.AddScoped<JwtTokenService>();

        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                var jwtOptions = configuration.GetSection(JwtOptions.SectionName).Get<JwtOptions>()
                    ?? throw new InvalidOperationException("Jwt configuration is missing.");

                if (string.IsNullOrWhiteSpace(jwtOptions.Key))
                {
                    throw new InvalidOperationException("Jwt:Key is not configured.");
                }

                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = true,
                    ValidateAudience = true,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    ValidIssuer = jwtOptions.Issuer,
                    ValidAudience = jwtOptions.Audience,
                    IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtOptions.Key)),
                    RoleClaimType = "role",
                    NameClaimType = ClaimTypes.NameIdentifier
                };
                options.MapInboundClaims = true;
                options.Events = new JwtBearerEvents
                {
                    OnMessageReceived = context =>
                    {
                        var accessToken = context.Request.Query["access_token"];
                        var path = context.HttpContext.Request.Path;
                        if (!string.IsNullOrWhiteSpace(accessToken) && path.StartsWithSegments("/hubs/live"))
                        {
                            context.Token = accessToken;
                        }

                        return Task.CompletedTask;
                    },
                    OnTokenValidated = context =>
                    {
                        if (context.Principal?.Identity is not ClaimsIdentity identity)
                        {
                            return Task.CompletedTask;
                        }

                        static string? GetClaimValue(ClaimsIdentity claimsIdentity, string claimType) =>
                            claimsIdentity.FindFirst(claimType)?.Value;

                        var userId = GetClaimValue(identity, JwtRegisteredClaimNames.Sub)
                            ?? GetClaimValue(identity, ClaimTypes.NameIdentifier);
                        if (!string.IsNullOrWhiteSpace(userId) &&
                            string.IsNullOrWhiteSpace(GetClaimValue(identity, ClaimTypes.NameIdentifier)))
                        {
                            identity.AddClaim(new Claim(ClaimTypes.NameIdentifier, userId));
                        }

                        var role = GetClaimValue(identity, "role") ?? GetClaimValue(identity, ClaimTypes.Role);
                        if (!string.IsNullOrWhiteSpace(role))
                        {
                            if (string.IsNullOrWhiteSpace(GetClaimValue(identity, "role")))
                            {
                                identity.AddClaim(new Claim("role", role));
                            }

                            if (string.IsNullOrWhiteSpace(GetClaimValue(identity, ClaimTypes.Role)))
                            {
                                identity.AddClaim(new Claim(ClaimTypes.Role, role));
                            }
                        }

                        return Task.CompletedTask;
                    }
                };
            });

        services.AddAuthorization();
        services.AddSignalR();
        services.ConfigureHttpJsonOptions(options =>
        {
            options.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        });
        services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            options.KnownIPNetworks.Clear();
            options.KnownProxies.Clear();
        });
        services.AddCors(options =>
        {
            options.AddPolicy("ReactDev", policy =>
                policy.WithOrigins("http://localhost:5173")
                    .AllowAnyHeader()
                    .AllowAnyMethod());
        });

        return services;
    }
}
