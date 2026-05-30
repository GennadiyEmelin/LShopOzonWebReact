using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class TaskDeferredAndSupplyArchive : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "ArchivedAt",
                table: "Supplies",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsArchived",
                table: "Supplies",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "DeferredAt",
                table: "ProductionTasks",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Supplies_IsArchived",
                table: "Supplies",
                column: "IsArchived");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Supplies_IsArchived",
                table: "Supplies");

            migrationBuilder.DropColumn(
                name: "ArchivedAt",
                table: "Supplies");

            migrationBuilder.DropColumn(
                name: "IsArchived",
                table: "Supplies");

            migrationBuilder.DropColumn(
                name: "DeferredAt",
                table: "ProductionTasks");
        }
    }
}
