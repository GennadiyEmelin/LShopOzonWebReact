using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class ProductionTaskItemPacking : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PackedAt",
                table: "ProductionTaskItems",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PackedByDisplayName",
                table: "ProductionTaskItems",
                type: "character varying(160)",
                maxLength: 160,
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PackedByUserId",
                table: "ProductionTaskItems",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "PackedSupplyId",
                table: "ProductionTaskItems",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PackedAt",
                table: "ProductionTaskItems");

            migrationBuilder.DropColumn(
                name: "PackedByDisplayName",
                table: "ProductionTaskItems");

            migrationBuilder.DropColumn(
                name: "PackedByUserId",
                table: "ProductionTaskItems");

            migrationBuilder.DropColumn(
                name: "PackedSupplyId",
                table: "ProductionTaskItems");
        }
    }
}
