using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    public partial class SupplyExpenses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SupplyExpenses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    PurchasedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedByUserId = table.Column<Guid>(type: "uuid", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SupplyExpenses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SupplyExpenses_Users_CreatedByUserId",
                        column: x => x.CreatedByUserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SupplyExpenses_CreatedAt",
                table: "SupplyExpenses",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_SupplyExpenses_CreatedByUserId",
                table: "SupplyExpenses",
                column: "CreatedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_SupplyExpenses_Name",
                table: "SupplyExpenses",
                column: "Name");

            migrationBuilder.CreateIndex(
                name: "IX_SupplyExpenses_PurchasedAt",
                table: "SupplyExpenses",
                column: "PurchasedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SupplyExpenses");
        }
    }
}
