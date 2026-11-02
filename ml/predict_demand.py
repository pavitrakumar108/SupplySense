import json
import math
import os
import sys

import joblib


def predict_batch():
    try:
        input_data = json.load(sys.stdin)
        requests = input_data.get("requests", [])
        if not requests:
            raise ValueError("No prediction requests were provided.")

        script_dir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.join(script_dir, "artifacts", "supplysense_best_model.joblib")
        model_bundle = joblib.load(model_path)
        model_type = model_bundle.get("model_type") if isinstance(model_bundle, dict) else None
        if model_type != "recursive_lag_7":
            raise ValueError(
                f"Unsupported selected model type: {model_type or 'unknown'}. "
                "The current app integration supports the validated recursive lag-7 model."
            )

        horizon_days = int(input_data.get("horizonDays", model_bundle.get("horizon_days", 7)))
        if not 1 <= horizon_days <= 90:
            raise ValueError("horizonDays must be between 1 and 90.")

        results = []
        for request in requests:
            variant_id = request.get("variantId")
            history = request.get("history") or []
            try:
                if not variant_id:
                    raise ValueError("variantId is required.")

                history = sorted(history, key=lambda point: point["date"])
                values = [float(point["value"]) for point in history]
                if not values or not all(math.isfinite(value) for value in values):
                    raise ValueError("Sales history must contain finite daily values.")

                observed_days = sum(value > 0 for value in values)
                if observed_days < 7:
                    results.append({
                        "variantId": variant_id,
                        "prediction": None,
                        "error": "At least seven days with recorded sales are required.",
                    })
                    continue

                future_values = list(values)
                horizon = []
                for _ in range(horizon_days):
                    next_value = max(0.0, future_values[-7])
                    future_values.append(next_value)
                    horizon.append(next_value)

                daily_average = sum(horizon) / horizon_days
                results.append({
                    "variantId": variant_id,
                    "prediction": daily_average,
                    "predictedTotal": sum(horizon),
                    "horizonDays": horizon_days,
                })
            except Exception as error:
                results.append({"variantId": variant_id, "prediction": None, "error": str(error)})

        print(json.dumps({
            "modelName": model_bundle.get("model_name", "Recursive lag-7 baseline"),
            "modelType": model_type,
            "horizonDays": horizon_days,
            "results": results,
        }))
    except Exception as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)


if __name__ == "__main__":
    predict_batch()
