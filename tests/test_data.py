"""Integration checks for the reproducible synthetic generator and feature inputs."""
import csv
import hashlib
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from ml import generate_data as generator


class DatasetTests(unittest.TestCase):
    def test_reproducible_records_and_integrity(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            digests = []
            for run in range(2):
                directory = base / str(run)
                with (patch.object(generator, "DATA", directory / "training"),
                      patch.object(generator, "PUBLIC", directory / "public")):
                    generator.generate(2000, generator.SEED)
                records = directory / "training" / "containers.csv"
                digests.append(hashlib.sha256(records.read_bytes()).hexdigest())
                with records.open() as stream:
                    rows = list(csv.DictReader(stream))
                manifest = json.loads((directory / "training/dataset-manifest.json").read_text())
                self.assertEqual(manifest["sha256"]["containers.csv"], digests[-1])
                self.assertEqual(manifest["dailyRecords"], 1826)
                self.assertEqual(len(rows), 2000)
                arrivals = [datetime.fromisoformat(row["arrivalTimestamp"]) for row in rows]
                departures = [datetime.fromisoformat(row["departureTimestamp"]) for row in rows]
                self.assertEqual(arrivals, sorted(arrivals))
                self.assertTrue(all(a < d for a, d in zip(arrivals, departures, strict=True)))
                self.assertTrue(all(a.utcoffset().total_seconds() == 14_400 for a in arrivals))
                self.assertEqual(len({row["containerId"] for row in rows}), len(rows))
                self.assertTrue(all(int(row["grossWeightKg"]) <= (28_000 if row["sizeFt"] == "20" else 36_000)
                                    for row in rows))
            self.assertEqual(*digests)


if __name__ == "__main__":
    unittest.main()
