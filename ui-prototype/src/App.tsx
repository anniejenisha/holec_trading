import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import CustomerDetailPage from "@/pages/CustomerDetailPage";
import CustomersPage from "@/pages/CustomersPage";
import DeductionsPage from "@/pages/DeductionsPage";
import EventLogPage from "@/pages/EventLogPage";
import IntakePage from "@/pages/IntakePage";
import LedgerPage from "@/pages/LedgerPage";
import LotDetailPage from "@/pages/LotDetailPage";
import LotsPage from "@/pages/LotsPage";
import NewTicketPage from "@/pages/NewTicketPage";
import NotFoundPage from "@/pages/NotFoundPage";
import PaymentsPage, { TransporterPaymentPage } from "@/pages/PaymentsPage";
import ReportsPage from "@/pages/ReportsPage";
import SalesPage from "@/pages/SalesPage";
import SupplierDetailPage from "@/pages/SupplierDetailPage";
import SuppliersPage from "@/pages/SuppliersPage";
import TransportPage from "@/pages/TransportPage";

function App() {
	return (
		<Routes>
			<Route element={<AppShell />}>
				<Route index element={<Navigate to="/lots" replace />} />

				<Route path="suppliers" element={<SuppliersPage />} />
				<Route path="suppliers/:id" element={<SupplierDetailPage />} />

				<Route path="customers" element={<CustomersPage />} />
				<Route path="customers/:id" element={<CustomerDetailPage />} />

				<Route path="lots" element={<LotsPage />} />
				<Route path="lots/:id" element={<LotDetailPage />} />

				<Route path="tickets/new" element={<NewTicketPage />} />

				<Route path="intake" element={<IntakePage />} />
				<Route path="intake/:id" element={<IntakePage />} />

				<Route path="deductions" element={<DeductionsPage />} />
				<Route path="deductions/:id" element={<DeductionsPage />} />

				<Route path="transport" element={<TransportPage />} />
				<Route path="transport/:id" element={<TransportPage />} />

				<Route path="sales" element={<SalesPage />} />
				<Route path="sales/:id" element={<SalesPage />} />

				<Route path="payments" element={<PaymentsPage />} />
				<Route path="payments/transporter/:id" element={<TransporterPaymentPage />} />
				<Route path="payments/:id" element={<PaymentsPage />} />

				<Route path="ledger" element={<LedgerPage />} />
				<Route path="reports" element={<ReportsPage />} />
				<Route path="event-log" element={<EventLogPage />} />

				<Route path="*" element={<NotFoundPage />} />
			</Route>
		</Routes>
	);
}

export default App;
