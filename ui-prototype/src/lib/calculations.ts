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
	moisturePct: number;
	moistureExcess: number;
	bagSize: number;
	moistureAdjustedKg: number;
	moistureDeductionKg: number;
	fmPct: number;
	fmDeductedPct: number;
	fmDeductionKg: number;
	acceptedNetKg: number;
	paidBags: number;
	refRatePerKg: number;
	grossValue: number;
	aflatoxinFee: number;
	dryingRatePerBag: number;
	dryingDeduction: number;
	hemaRatePerBag: number;
	hemaDeduction: number;
	totalOtherCharges: number;
	netPayable: number;
	deliveredBags: number;
	effectivePricePerBag: number;
}

// Deduction engine — 8-step Payable calculation
export function computePayable(
	lot: Pick<Lot, "grossKg" | "tareKg"> & {
		moisturePct?: number;
		fmPct?: number;
		refRatePerKg?: number;
		aflatoxinFee?: number;
		dryingRatePerBag?: number;
		hemaRatePerBag?: number;
	},
): PayableResult {
	const grossKg = lot.grossKg ?? 0;
	const tareKg = lot.tareKg ?? 0;
	const moisturePct = lot.moisturePct ?? 13.5;
	const fmPct = lot.fmPct ?? 0;

	// Step 1: Weight
	const netKg = Math.max(0, grossKg - tareKg);

	// Step 2: Moisture
	const moistureStd = 13.5;
	const moistureExcess = Math.max(0, moisturePct - moistureStd);
	const bagSize = 90 + moistureExcess;
	const moistureAdjustedKg = netKg > 0 && bagSize > 0 ? (netKg / bagSize) * 90 : netKg;
	const moistureDeductionKg = Math.max(0, netKg - moistureAdjustedKg);

	// Step 3: Foreign matter
	const fmDeductedPct = Math.max(0, fmPct - 0.5);
	const fmDeductionKg = moistureAdjustedKg * (fmDeductedPct / 100);

	// Step 4: Accepted quantity
	const acceptedNetKg = Math.max(0, moistureAdjustedKg - fmDeductionKg);
	const paidBags = acceptedNetKg > 0 ? acceptedNetKg / 90 : 0;

	// Step 5: Payable value
	const refRatePerKg = lot.refRatePerKg ?? 48;
	const grossValue = acceptedNetKg * refRatePerKg;

	// Step 6: Other charges
	const aflatoxinFee = lot.aflatoxinFee ?? 0;
	const dryingRatePerBag = lot.dryingRatePerBag ?? 50;
	const dryingDeduction = dryingRatePerBag * paidBags;
	const hemaRatePerBag = lot.hemaRatePerBag ?? 24.30;
	const hemaDeduction = hemaRatePerBag * paidBags;
	const totalOtherCharges = aflatoxinFee + dryingDeduction + hemaDeduction;

	// Step 7: Net payable
	const netPayable = Math.max(0, grossValue - totalOtherCharges);

	// Step 8: Bag Impact
	const deliveredBags = netKg > 0 ? netKg / 90 : 0;
	const effectivePricePerBag = deliveredBags > 0 ? netPayable / deliveredBags : 0;

	return {
		netKg,
		moisturePct,
		moistureExcess,
		bagSize,
		moistureAdjustedKg,
		moistureDeductionKg,
		fmPct,
		fmDeductedPct,
		fmDeductionKg,
		acceptedNetKg,
		paidBags,
		refRatePerKg,
		grossValue,
		aflatoxinFee,
		dryingRatePerBag,
		dryingDeduction,
		hemaRatePerBag,
		hemaDeduction,
		totalOtherCharges,
		netPayable,
		deliveredBags,
		effectivePricePerBag,
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
