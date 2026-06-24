using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class IntegrationsAndTelegram : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AppIntegrationSettings",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false),
                    OzonClientId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    OzonApiKey = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: false),
                    OzonBaseUrl = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AppIntegrationSettings", x => x.Id);
                });

            migrationBuilder.AddColumn<string>(
                name: "TelegramChatId",
                table: "Users",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "TelegramConnectToken",
                table: "Users",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "TelegramConnectedAt",
                table: "Users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TelegramNotifyEvents",
                table: "Users",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AppIntegrationSettings");

            migrationBuilder.DropColumn(
                name: "TelegramChatId",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TelegramConnectToken",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TelegramConnectedAt",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TelegramNotifyEvents",
                table: "Users");
        }
    }
}
