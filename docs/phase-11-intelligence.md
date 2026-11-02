# Phase 11: Sales history and demand intelligence

Demand runs use warehouse sales recorded in the last 28 days. The selected artifact is `ml/artifacts/supplysense_best_model.joblib`; its validation winner is a recursive lag-7 baseline, so it repeats the recent weekly sales pattern across the requested horizon. The app currently requests a 14-day forecast.

The category-level training CSV and the separate M5 LightGBM artifact are not current warehouse sales and do not map to SupplySense's SKU/warehouse identifiers. They cannot produce a valid current SKU forecast without a matching sales feed. A full-warehouse run with no `SALE` or `RETURN` movements returns `INSUFFICIENT_SALES_HISTORY` and does not write zero-demand forecasts.

Install the model loader dependency with `python3 -m pip install -r ml/requirements.txt`. Set `PYTHON_EXECUTABLE` if the API must use a specific Python environment; otherwise it launches `python3` from `PATH`.

## Delivered

- Sales history is rebuilt by SKU, warehouse, and UTC business date from `SALE` and `RETURN` movements. Cancelled sales are therefore offset by their return movement.
- Missing dates are materialized as zero values for SKUs with sales movements in the selected window.
- The recursive lag-7 model runs for SKUs with at least seven days that recorded sales. Model execution errors are returned to the manager instead of silently falling back.
- The deterministic exponential-smoothing formula remains available as a fallback for explicitly selected SKU requests.
- Anomalies use the prior rolling 28-day mean and sample standard deviation, with a three-sigma threshold and the documented zero-standard-deviation rule.
- Reorder recommendations use lead-time demand, safety stock, current available stock, MOQ, pack size, and the stored reproducible input window.
- Fewer than seven observed sales days produces no full-warehouse forecast and an `INSUFFICIENT_HISTORY` recommendation with quantity zero.
- Recommendation approval creates a `DRAFT` purchase order only; it never changes inventory or submits the order.
- Recommendation approval/rejection is idempotent and audited.

## Main endpoints

`POST /api/v1/intelligence/run`, `GET /api/v1/analytics/sales-history`, `GET /api/v1/analytics/forecasts`, `GET /api/v1/analytics/anomalies`, `GET /api/v1/analytics/recommendations`, and the recommendation decision endpoints.

