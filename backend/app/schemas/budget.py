import uuid
from datetime import date as _Date
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict


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
