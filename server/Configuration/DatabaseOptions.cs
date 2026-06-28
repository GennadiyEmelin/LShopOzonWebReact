namespace LShopOzonWebReact.Api.Configuration;

public sealed class DatabaseOptions
{
    public const string SectionName = "Database";

    public bool ApplyMigrationsOnStartup { get; set; }
}
