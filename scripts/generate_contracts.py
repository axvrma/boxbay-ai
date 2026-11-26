import json

from services.intelligence.api import app
from services.intelligence.forecasting import ROOT

path = ROOT / "packages/contracts/openapi.json"
path.write_text(json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n")
