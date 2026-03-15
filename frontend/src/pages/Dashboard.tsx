import React, { useState, useEffect } from "react";
import { useAuth } from "../context/Auth";
import { Navbar } from "../components/Navbar";
import { Kpi } from "../components/Kpi";
import { Aisummary } from "../components/Aisummary";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { UploadCloud, FileSpreadsheet, Loader2 } from "lucide-react";
import { Bar, Line } from "react-chartjs-2";
import { getChartConfig } from "../utils/chartSelector";

interface Dataset {
  _id: string;
  name: string;
  originalData: any[];
  kpis: Record<string, any>;
  charts: any[];
  insights: string;
  createdAt: string;
}

export const Dashboard: React.FC = () => {
  const { token, user, logout } = useAuth();
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [activeDataset, setActiveDataset] = useState<Dataset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (token) {
      fetchDatasets();
    }
  }, [token]);

  const fetchDatasets = async () => {
    if (!token) return;
    try {
      const resp = await fetch("http://localhost:5000/api/datasets", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resp.status === 401) {
        logout();
        return;
      }
      const data = await resp.json();
      if (resp.ok) {
        setDatasets(data);
        if (data.length > 0) setActiveDataset(data[0]);
      }
    } catch (error) {
      console.error("Error fetching datasets:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const resp = await fetch("http://localhost:5000/api/datasets/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      if (resp.status === 401) {
        logout();
        return;
      }
      const newDataset = await resp.json();
      if (resp.ok) {
        // Append dynamically to front and set active
        setDatasets(prev => [newDataset, ...prev]);
        setActiveDataset(newDataset);
      } else {
        alert(newDataset.msg || "Error uploading file");
      }
    } catch (error) {
      console.error(error);
      alert("Error parsing document");
    } finally {
      setUploading(false);
      // reset file input
      e.target.value = "";
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <Loader2 className="animate-spin text-indigo-500 w-12 h-12" />
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans">
      <Navbar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Hello, {user?.name ? user.name.split(' ')[0] : 'User'} 👋</h1>
            <p className="text-slate-400">Here's the intelligent breakdown of your dynamic datasets.</p>
          </div>
          
          <div className="relative">
            <input 
              type="file" 
              accept=".xlsx,.csv" 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              onChange={handleFileUpload}
              disabled={uploading}
            />
            <Button variant="primary" className="flex items-center gap-2 pointer-events-none" isLoading={uploading}>
              {!uploading && <UploadCloud size={20} />}
              {uploading ? "Analyzing & Generating..." : "Upload Dataset"}
            </Button>
          </div>
        </div>

        {datasets.length === 0 ? (
          <Card className="text-center py-20 bg-slate-900/50 border-dashed border-slate-700">
            <div className="bg-slate-800/50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileSpreadsheet className="text-indigo-400 w-10 h-10" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">No Datasets Found</h3>
            <p className="text-slate-400 max-w-sm mx-auto">Upload an Excel (.xlsx) or CSV file to immediately generate KPIs, interactive charts, and AI-powered insights.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Sidebar list of old datasets */}
            <div className="lg:col-span-1 space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-4">Recent Datasets</h3>
              {datasets.map(ds => (
                <button 
                  key={ds._id}
                  onClick={() => setActiveDataset(ds)}
                  className={`w-full text-left p-4 rounded-xl border transition-all ${
                    activeDataset?._id === ds._id 
                      ? "bg-indigo-600/10 border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.15)]" 
                      : "bg-slate-900 border-slate-800 hover:bg-slate-800"
                  }`}
                >
                  <p className="font-medium text-white line-clamp-1">{ds.name}</p>
                  <p className="text-xs text-slate-500 mt-1">
                    {new Date(ds.createdAt).toLocaleDateString()}
                  </p>
                </button>
              ))}
            </div>

            {/* Main Visualizations per dataset */}
            <div className="lg:col-span-3 space-y-8 animate-in fade-in zoom-in-95 duration-500">
              {activeDataset && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                    {Object.entries(activeDataset.kpis || {}).map(([key, metrics]: any) => (
                      <Kpi 
                        key={key} 
                        title={`Total ${key}`} 
                        value={metrics.sum} 
                        trend={`Avg / row: ${metrics.avg}`} 
                        type="sum"
                      />
                    ))}
                  </div>
                  {activeDataset.charts && activeDataset.charts.length > 0 && (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                      {activeDataset.charts.map((chartDef, idx) => {
                        const { data, options, componentType } = getChartConfig(chartDef, activeDataset.originalData);
                        return (
                          <Card key={idx} className="h-80 flex flex-col justify-center bg-slate-900 border-slate-800/80">
                            <div className="h-full w-full">
                              {componentType === 'Bar' ? (
                                <Bar data={data} options={options} />
                              ) : (
                                <Line data={data} options={options} />
                              )}
                            </div>
                          </Card>
                        )
                      })}
                    </div>
                  )}

                  {activeDataset.insights && (
                    <Aisummary insights={activeDataset.insights} />
                  )}

                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
