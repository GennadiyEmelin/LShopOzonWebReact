using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class TelegramDailyReports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "TelegramDailyReportEnabled",
                table: "Users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateOnly>(
                name: "TelegramDailyReportLastSentOn",
                table: "Users",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TelegramDailyReportSections",
                table: "Users",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "TelegramDailyReportTime",
                table: "Users",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "19:00");

            migrationBuilder.AddColumn<string>(
                name: "TelegramDailyReportTimezone",
                table: "Users",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "Asia/Almaty");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TelegramDailyReportEnabled",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TelegramDailyReportLastSentOn",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TelegramDailyReportSections",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TelegramDailyReportTime",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TelegramDailyReportTimezone",
                table: "Users");
        }
    }
}
