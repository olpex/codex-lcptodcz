import { useEffect, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import type { KPI } from "../types/api";

const EMPTY_KPI: KPI = {
  active_groups: 0,
  active_trainees: 0,
  facility_load_pct: 0,
  training_plan_progress_pct: 0,
  forecast_graduation: 0,
  forecast_employment: 0
};

export function DashboardPage() {
  const { request } = useAuth();
  const { showError } = useToast();
  const [kpi, setKpi] = useState<KPI>(EMPTY_KPI);
  const lastErrorMessageRef = useRef("");

  const fetchKpi = async () => {
    try {
      const data = await request<KPI>("/dashboard/kpi");
      setKpi(data);
      lastErrorMessageRef.current = "";
    } catch (error) {
      const message = (error as Error).message;
      if (message !== lastErrorMessageRef.current) {
        showError(message);
        lastErrorMessageRef.current = message;
      }
    }
  };

  useEffect(() => {
    fetchKpi();
    const timer = window.setInterval(fetchKpi, 15000);
    return () => window.clearInterval(timer);
  }, []);

  const chartData = [
    { name: "Групи", value: kpi.active_groups },
    { name: "Слухачі", value: kpi.active_trainees },
    { name: "Випуск", value: kpi.forecast_graduation },
    { name: "Працевлашт.", value: kpi.forecast_employment }
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title="Активні групи">
          <p className="text-4xl font-heading font-bold text-pine">{kpi.active_groups}</p>
        </Panel>
        <Panel title="Активні слухачі">
          <p className="text-4xl font-heading font-bold text-pine">{kpi.active_trainees}</p>
        </Panel>
        <Panel title="Завантаженість бази">
          <p className="text-4xl font-heading font-bold text-pine">{kpi.facility_load_pct}%</p>
        </Panel>
        <Panel title="Виконання плану">
          <p className="text-4xl font-heading font-bold text-pine">{kpi.training_plan_progress_pct}%</p>
        </Panel>
      </div>
      <Panel title="Прогнозні показники">
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="value" fill="#1d4f47" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Panel>
    </div>
  );
}
