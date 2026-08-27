// Calculation engine ported VERBATIM from ui-prototype/reference/holec-erp-prototype.html
// (computeIntake, computePayable, computeTransport, computeLandedCost, computeSale).
// Do not "improve" the math here without checking it against the reference file first —
// numeric parity with the HTML prototype is the point.

import type { Lot } from "@/types";

export interface IntakeResult {
	netKg: number;
}

export function computeIntake(lot: Pick<Lot, "grossKg" | "tareKg">): IntakeResult {
	const netKg = (lot.grossKg ?? 0) - (lot.tareKg ?? 0);
	return { netKg };
}

export interface PayableResult {
	netKg: number;
	band: string;
	moisturePenaltyPct: number;
	moistureDeductionKg: number;
	fmDeductionKg: number;
	acceptedNetKg: number;
	refRatePerKg: number;
	grossValue: number;
	baggingDeduction: number;
	aflatoxinTestFee: number;
	aflatoxinPass: boolean;
	netPayable: number;
}

// Deduction engine — mirrors Module 8 (payable engine)
export function computePayable(
	lot: Pick<Lot, "grossKg" | "tareKg" | "moisturePct" | "fmPct" | "bags" | "aflatoxinTested" | "aflatoxinPpb">,
): PayableResult {
	const grossKg = lot.grossKg ?? 0;
	const tareKg = lot.tareKg ?? 0;
	const moisturePct = lot.moisturePct ?? 0;
	const fmPct = lot.fmPct ?? 0;
	const bags = lot.bags ?? 0;

	const netKg = grossKg - tareKg;
	const moistureStd = 13.5;
	let moisturePenaltyPct = 0;
	let band = "≤14%";
	if (moisturePct > 20) {
		band = ">20% (wet buy)";
		moisturePenaltyPct = (moisturePct - moistureStd) * 1.6;
	} else if (moisturePct > 14) {
		band = "14–20%";
		moisturePenaltyPct = (moisturePct - moistureStd) * 1.2;
	} else {
		moisturePenaltyPct = Math.max(0, (moisturePct - moistureStd) * 1.0);
	}
	moisturePenaltyPct = Math.max(0, moisturePenaltyPct);

	const moistureDeductionKg = netKg * (moisturePenaltyPct / 100);
	const fmDeductionKg = netKg * (Math.max(0, fmPct - 0.5) / 100) * 1.5;
	const acceptedNetKg = Math.max(0, netKg - moistureDeductionKg - fmDeductionKg);

	const refRatePerKg = 48; // reference rate KES/kg
	const grossValue = acceptedNetKg * refRatePerKg;
	const baggingRatePerBag = 25;
	const baggingDeduction = bags * baggingRatePerBag;
	const aflatoxinTestFee = lot.aflatoxinTested ? 300 : 0;
	const aflatoxinPass = (lot.aflatoxinPpb ?? 0) <= 10;

	const netPayable = Math.max(0, grossValue - baggingDeduction - aflatoxinTestFee);

	return {
		netKg,
		band,
		moisturePenaltyPct,
		moistureDeductionKg,
		fmDeductionKg,
		acceptedNetKg,
		refRatePerKg,
		grossValue,
		baggingDeduction,
		aflatoxinTestFee,
		aflatoxinPass,
		netPayable,
	};
}

export interface TransportResult {
	haulage: number;
	cess: number;
	offloading: number;
	total: number;
	tolerance: number;
	expectedKg: number;
	deliveredKg: number;
	lossKg: number;
	recoveredKES: number;
}

export function computeTransport(
	lot: Pick<Lot, "haulage" | "cess" | "offloading" | "grossKg" | "tareKg" | "moisturePct" | "fmPct" | "bags" | "aflatoxinTested" | "aflatoxinPpb">,
): TransportResult {
	const haulage = lot.haulage || 0;
	const cess = lot.cess || 0;
	const offloading = lot.offloading || 0;
	const total = haulage + cess + offloading;
	const tolerance = 80;
	const expectedKg = computePayable(lot).acceptedNetKg;
	const deliveredKg = expectedKg; // demo: no shrinkage variance modeled beyond seed
	return { haulage, cess, offloading, total, tolerance, expectedKg, deliveredKg, lossKg: 0, recoveredKES: 0 };
}

export interface LandedCostResult {
	totalCost: number;
	perKg: number;
	kg: number;
}

export function computeLandedCost(
	lot: Pick<Lot, "grossKg" | "tareKg" | "moisturePct" | "fmPct" | "bags" | "aflatoxinTested" | "aflatoxinPpb" | "haulage" | "cess" | "offloading">,
): LandedCostResult {
	const payable = computePayable(lot);
	const transport = computeTransport(lot);
	const totalCost = payable.netPayable + transport.total;
	const kg = payable.acceptedNetKg || 1;
	return { totalCost, perKg: totalCost / kg, kg };
}

export interface SaleResult {
	kg: number;
	revenue: number;
	cogs: number;
	margin: number;
	marginPerTonne: number;
}

export function computeSale(
	lot: Pick<
		Lot,
		"grossKg" | "tareKg" | "moisturePct" | "fmPct" | "bags" | "aflatoxinTested" | "aflatoxinPpb" | "haulage" | "cess" | "offloading" | "customerId" | "sellRatePerKg"
	>,
): SaleResult | null {
	if (!lot.customerId || !lot.sellRatePerKg) return null;
	const kg = computePayable(lot).acceptedNetKg;
	const revenue = kg * lot.sellRatePerKg;
	const landed = computeLandedCost(lot);
	const cogs = landed.totalCost;
	const margin = revenue - cogs;
	const marginPerTonne = (margin / kg) * 1000;
	return { kg, revenue, cogs, margin, marginPerTonne };
}

// Loss reconciliation — mirrors Module 9's inline `updateLoss` logic.
export interface LossResult {
	expected: number;
	delivered: number;
	lossKg: number;
	tolerance: number;
	withinTolerance: boolean;
	recoverableKg: number;
	recoveredKES: number;
}

export function computeLoss(expected: number, delivered: number): LossResult {
	const tolerance = 80;
	const lossKg = Math.max(0, expected - delivered);
	const withinTolerance = lossKg <= tolerance;
	const recoverableKg = withinTolerance ? 0 : lossKg - tolerance;
	const sellRate = 52;
	const recoveredKES = recoverableKg * sellRate;
	return { expected, delivered, lossKg, tolerance, withinTolerance, recoverableKg, recoveredKES };
}
