# Offline model training

Install `requirements-dev.txt` and Homebrew `libomp` on macOS. Run `make train` from the repository root. Historical monthly input is validated before fitting. A deterministic generator writes a local synthetic CSV. XGBoost fits lagged monthly candidates and a dwell model. For each demand direction a chronological calibration split selects from three candidates. An explicit holdout assesses it. The generated bundle includes rolling-origin holdout forecasts, the January 2026 one-step estimate and a historical monthly fallback profile. The default September 2025 scenario uses the corresponding earlier-origin model forecast as one capacity-planning input.

Dwell features use booking lead, cargo, weight, length, service class and a prior carrier profile. Cold starts use an explicit sentinel. The exported additive tree evaluator is checked against native XGBoost on holdout rows. A missing bundle uses an appointment-based dwell estimate and vessel-only forecasting. Portable model data carries no executable pickle payload.

Review data digests, leakage checks, holdout error, high-volume error, interval coverage and cold-start degradation before promotion. A future version needs a new artifact identifier and independent operational validation before any adoption claim.
