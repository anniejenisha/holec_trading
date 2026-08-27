# Copyright (c) 2026, Holec
#
# Shared payable-weight deduction math. This exists in exactly one place
# and is called from both the Intake submission (to decide the pass/block
# banner) and the payable engine (Lot._create_state_cost_entries, when the
# "Moisture Deduction" Cost Ledger Entry actually gets posted) - do not
# duplicate this formula anywhere else.

MOISTURE_STANDARD_PCT = 13.5
MOISTURE_HARD_LIMIT_PCT = 20
BAG_WEIGHT_KG = 90


def compute_moisture_deduction(net_weight_kg: float, moisture_pct: float) -> dict:
	"""
	Moisture <= 14%  -> no deduction (at or under standard).
	14% < Moisture <= 20% -> shrinkage-based deduction:
	    accepted_kg = net_weight_kg * (100 - moisture_pct) / (100 - MOISTURE_STANDARD_PCT)
	    moisture_deduction_kg = net_weight_kg - accepted_kg
	Moisture > 20% -> this function does not decide pass/block; that's
	    handled explicitly by the caller (see moisture_exceeds_hard_limit).
	    If called anyway, uses the same shrinkage formula so a downstream
	    posting always has a sane number once an override has been logged.
	"""
	net_weight_kg = net_weight_kg or 0
	moisture_pct = moisture_pct or 0

	if moisture_pct <= 14:
		return {"accepted_kg": net_weight_kg, "moisture_deduction_kg": 0.0}

	accepted_kg = net_weight_kg * (100 - moisture_pct) / (100 - MOISTURE_STANDARD_PCT)
	moisture_deduction_kg = net_weight_kg - accepted_kg
	return {"accepted_kg": accepted_kg, "moisture_deduction_kg": moisture_deduction_kg}


def moisture_exceeds_hard_limit(moisture_pct: float) -> bool:
	return bool(moisture_pct and moisture_pct > MOISTURE_HARD_LIMIT_PCT)


def calculate_bag_count(net_weight_kg: float) -> int:
	return int((net_weight_kg or 0) // BAG_WEIGHT_KG)
