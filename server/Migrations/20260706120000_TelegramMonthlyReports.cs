using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class TelegramMonthlyReports : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "TelegramMonthlyReportEnabled",
                table: "Users",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateOnly>(
                name: "TelegramMonthlyReportLastSentOn",
                table: "Users",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "TelegramMonthlyReportSections",
                table: "Users",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "TelegramMonthlyReportTime",
                table: "Users",
                type: "character varying(8)",
                maxLength: 8,
                nullable: false,
                defaultValue: "19:00");

            migrationBuilder.AddColumn<string>(
                name: "TelegramMonthlyReportTimezone",
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
                name: "TelegramMonthlyReportEnabled",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TelegramMonthlyReportLastSentOn",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TelegramMonthlyReportSections",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TelegramMonthlyReportTime",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TelegramMonthlyReportTimezone",
                table: "Users");
        }
    }
}
