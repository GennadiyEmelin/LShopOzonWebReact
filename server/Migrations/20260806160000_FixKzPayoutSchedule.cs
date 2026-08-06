using LShopOzonWebReact.Api.Data;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LShopOzonWebReact.Api.Migrations
{
    /// <summary>
    /// Ставит казахстанский график выплат: без задержки, по средам.
    ///
    /// Отдельной миграцией, потому что предыдущая уже применена на сервере —
    /// EF считает её выполненной по идентификатору и повторно не запускает,
    /// сколько бы правок в файл ни внести.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20260806160000_FixKzPayoutSchedule")]
    public partial class FixKzPayoutSchedule : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 0 недель — выплата в первую среду после конца периода,
            // в котором Ozon выставил документ. Сверено с кабинетом:
            // период 3–9 августа -> среда 12 августа.
            migrationBuilder.Sql(
                "UPDATE \"CalculatorSettings\" SET \"PayoutDelayWeeks\" = 0, \"PayoutDayOfWeek\" = 3;");

            migrationBuilder.AlterColumn<int>(
                name: "PayoutDelayWeeks",
                table: "CalculatorSettings",
                type: "integer",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "integer",
                oldDefaultValue: 3);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<int>(
                name: "PayoutDelayWeeks",
                table: "CalculatorSettings",
                type: "integer",
                nullable: false,
                defaultValue: 3,
                oldClrType: typeof(int),
                oldType: "integer",
                oldDefaultValue: 0);
        }
    }
}
