import uuid
from datetime import date as _Date
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class BudgetCreate(BaseModel):
    category_id: uuid.UUID
    amount: Decimal
    month: _Date  # First day of month
    is_recurring: bool = False


class BudgetUpdate(BaseModel):
    amount: Optional[Decimal] = None
    effective_month: Optional[_Date] = None


class BudgetRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    category_id: uuid.UUID
    amount: Decimal
    month: _Date
    is_recurring: bool

    model_config = ConfigDict(from_attributes=True)


class BudgetVsActual(BaseModel):
    category_id: uuid.UUID
    category_name: str
    category_icon: str
    category_color: str
    group_id: Optional[uuid.UUID] = None
    group_name: Optional[str] = None
    budget_amount: Optional[Decimal] = None
    actual_amount: Decimal
    projected_amount: Decimal = Decimal("0")
    prev_month_amount: Decimal = Decimal("0")
    projected_prev_month_amount: Decimal = Decimal("0")
    percentage_used: Optional[float] = None
    is_recurring: bool = False


class BudgetCategoryForecast(BaseModel):
    category_id: uuid.UUID
    # Expected month-end spending: spent so far plus everything still to come.
    expected: Decimal
    # Scheduled transactions or unpaid recurring charges still to come.
    fixed_upcoming: Decimal
    # Net spending per day of the month so far (index 0 is day 1).
    daily_actual: list[Decimal]
    # Spending expected per day for the rest of the month (index 0 is day 1).
    daily_upcoming: list[Decimal]
    # Whether part of the forecast was learned from earlier months.
    from_history: bool = False


class BudgetForecast(BaseModel):
    month: _Date
    days_in_month: int
    days_elapsed: int
    learned_months: int
    categories: list[BudgetCategoryForecast]


class BudgetSuggestion(BaseModel):
    category_id: uuid.UUID
    category_name: str
    category_icon: str
    category_color: str
    group_id: Optional[uuid.UUID] = None
    group_name: Optional[str] = None
    suggested_amount: Decimal
    total_spent: Decimal
    months_with_data: int
    existing_budget: bool = False


class BudgetSuggestionResponse(BaseModel):
    month: _Date
    months_requested: int
    months_analyzed: int
    suggestions: list[BudgetSuggestion]


class BudgetBatchItem(BaseModel):
    category_id: uuid.UUID
    amount: Decimal = Field(gt=0)


class BudgetBatchCreate(BaseModel):
    month: _Date
    is_recurring: bool = False
    items: list[BudgetBatchItem] = Field(min_length=1, max_length=200)


class BudgetCopyMonthRequest(BaseModel):
    source_month: _Date
    target_month: _Date
    adjustment_percentage: Decimal = Field(
        default=Decimal("0.0"), ge=Decimal("-100"), le=Decimal("1000")
    )
    overwrite_existing: bool = False


class BudgetRolloverCategory(BaseModel):
    category_id: uuid.UUID
    category_name: str
    budgeted: Decimal
    actual_spent: Decimal
    projected_spent: Decimal
    remaining: Decimal
    carryover_eligible: bool


class BudgetRolloverSummaryResponse(BaseModel):
    month: _Date
    total_budgeted: Decimal
    total_spent: Decimal
    total_projected_spent: Decimal
    net_surplus: Decimal
    categories: list[BudgetRolloverCategory]


class BudgetMultiMonthForecastItem(BaseModel):
    month: _Date
    projected_budget: Decimal
    projected_spend: Decimal
    projected_variance: Decimal


class BudgetForecastResponse(BaseModel):
    forecast_months: int
    items: list[BudgetMultiMonthForecastItem]
