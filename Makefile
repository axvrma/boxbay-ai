PYTHON ?= .venv/bin/python

.PHONY: setup api web train benchmark contracts test build verify profile
setup:
	python3.11 -m venv .venv
	$(PYTHON) -m pip install -r services/intelligence/requirements-dev.txt
	npm --prefix apps/web ci

api:
	BOXBAY_LOCAL_OPEN=1 $(PYTHON) -m uvicorn services.intelligence.api:app --host 127.0.0.1 --port 8000

web:
	npm --prefix apps/web run dev -- --host 127.0.0.1

train:
	$(PYTHON) -m services.intelligence.training

benchmark:
	$(PYTHON) -m services.intelligence.benchmarks

contracts:
	$(PYTHON) -m scripts.generate_contracts
	npm --prefix apps/web run contracts

profile:
	$(PYTHON) -m scripts.profile_engine

test:
	$(PYTHON) -m pytest -q
	npm --prefix apps/web test

build:
	npm --prefix apps/web run build

verify:
	$(PYTHON) -m ruff check services scripts
	$(PYTHON) -m mypy services/intelligence/domain.py services/intelligence/constraints.py services/intelligence/energy.py
	npm --prefix apps/web run lint
	$(MAKE) test build
