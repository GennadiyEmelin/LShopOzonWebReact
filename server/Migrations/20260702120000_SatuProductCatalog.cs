using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class SatuProductCatalog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SatuAnalyticsCacheEntries",
                columns: table => new
                {
                    CacheKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ShopId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    PeriodFrom = table.Column<DateOnly>(type: "date", nullable: false),
                    PeriodTo = table.Column<DateOnly>(type: "date", nullable: false),
                    PayloadJson = table.Column<string>(type: "text", nullable: false),
                    ComputedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SatuAnalyticsCacheEntries", x => x.CacheKey);
                });

            migrationBuilder.CreateTable(
                name: "SatuProducts",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SatuProductId = table.Column<long>(type: "bigint", nullable: false),
                    ShopId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    OfferId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Name = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Price = table.Column<decimal>(type: "numeric", nullable: false),
                    OldPrice = table.Column<decimal>(type: "numeric", nullable: false),
                    Stock = table.Column<int>(type: "integer", nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    CategoryId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    ImageUrlsJson = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    ProductUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    ImageUrl = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    CurrencyCode = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    LastSyncedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ExternalUpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    RawJson = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SatuProducts", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SatuSyncStates",
                columns: table => new
                {
                    ShopId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    LastSyncStartedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastSyncCompletedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    TotalProducts = table.Column<int>(type: "integer", nullable: false),
                    SyncedProducts = table.Column<int>(type: "integer", nullable: false),
                    ErrorMessage = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    IsFullSync = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SatuSyncStates", x => x.ShopId);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SatuAnalyticsCacheEntries_ShopId_PeriodFrom_PeriodTo",
                table: "SatuAnalyticsCacheEntries",
                columns: new[] { "ShopId", "PeriodFrom", "PeriodTo" });

            migrationBuilder.CreateIndex(
                name: "IX_SatuProducts_CategoryId",
                table: "SatuProducts",
                column: "CategoryId");

            migrationBuilder.CreateIndex(
                name: "IX_SatuProducts_IsActive",
                table: "SatuProducts",
                column: "IsActive");

            migrationBuilder.CreateIndex(
                name: "IX_SatuProducts_LastSyncedAt",
                table: "SatuProducts",
                column: "LastSyncedAt");

            migrationBuilder.CreateIndex(
                name: "IX_SatuProducts_Name",
                table: "SatuProducts",
                column: "Name");

            migrationBuilder.CreateIndex(
                name: "IX_SatuProducts_OfferId",
                table: "SatuProducts",
                column: "OfferId");

            migrationBuilder.CreateIndex(
                name: "IX_SatuProducts_ShopId",
                table: "SatuProducts",
                column: "ShopId");

            migrationBuilder.CreateIndex(
                name: "IX_SatuProducts_ShopId_SatuProductId",
                table: "SatuProducts",
                columns: new[] { "ShopId", "SatuProductId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_SatuProducts_Status",
                table: "SatuProducts",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(name: "SatuAnalyticsCacheEntries");
            migrationBuilder.DropTable(name: "SatuProducts");
            migrationBuilder.DropTable(name: "SatuSyncStates");
        }
    }
}
