namespace LShopOzonWebReact.Api.Configuration;

public sealed class AdminOptions
{
    public const string SectionName = "Admin";

    public string? PublicAdminerUrl { get; set; }

    public string PostgresUser { get; set; } = "lshop";

    public string PostgresDatabase { get; set; } = "lshop_ozon";
}
