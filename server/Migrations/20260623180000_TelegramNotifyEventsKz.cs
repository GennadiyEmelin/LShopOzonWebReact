using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class TelegramNotifyEventsKz : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TelegramNotifyEventsKz",
                table: "Users",
                type: "character varying(4000)",
                maxLength: 4000,
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TelegramNotifyEventsKz",
                table: "Users");
        }
    }
}
