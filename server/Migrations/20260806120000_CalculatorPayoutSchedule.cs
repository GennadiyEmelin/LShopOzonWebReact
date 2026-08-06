using LShopOzonWebReact.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20260806120000_CalculatorPayoutSchedule")]
    public partial class CalculatorPayoutSchedule : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // График выплат Ozon по API не приходит и различается между кабинетами:
            // в РФ — среда через 3 недели, в KZ задержка короче.
            // Поэтому параметры настраиваются, а не зашиты в код.
            migrationBuilder.AddColumn<int>(
                name: "PayoutDelayWeeks",
                table: "CalculatorSettings",
                type: "integer",
                nullable: false,
                defaultValue: 3);

            migrationBuilder.AddColumn<int>(
                name: "PayoutDayOfWeek",
                table: "CalculatorSettings",
                type: "integer",
                nullable: false,
                defaultValue: 3);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "PayoutDelayWeeks", table: "CalculatorSettings");
            migrationBuilder.DropColumn(name: "PayoutDayOfWeek", table: "CalculatorSettings");
        }
    }
}
