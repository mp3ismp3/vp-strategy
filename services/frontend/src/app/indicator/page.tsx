"use client";

import { useState } from "react";
import MACDPage from "@/app/macd/page";
import FVGPage from "@/app/fvg/page";
import LiquidityPage from "@/app/liquidity/page";

type IndicatorTab = "macd" | "fvg" | "liquidity";

const tabs: { key: IndicatorTab; icon: string; label: string; description: string }[] = [
  {
    key: "macd",
    icon: "📉",
    label: "MACD Divergence",
    description: "日線 + 周線背離偵測",
  },
  {
    key: "fvg",
    icon: "📐",
    label: "FVG",
    description: "公允價值缺口",
  },
  {
    key: "liquidity",
    icon: "💧",
    label: "Liquidity Sweep",
    description: "流動性掃蕩偵測",
  },
];

export default function IndicatorPage() {
  const [activeTab, setActiveTab] = useState<IndicatorTab>("macd");

  return (
    <div>
      {/* Tab Navigation */}
      <div className="sticky top-16 z-40 bg-white border-b">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-1 overflow-x-auto py-2">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${
                  activeTab === tab.key
                    ? "bg-gray-900 text-white shadow-sm"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                <span
                  className={`hidden sm:inline text-xs ${
                    activeTab === tab.key ? "text-gray-300" : "text-gray-400"
                  }`}
                >
                  — {tab.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === "macd" && <MACDPage />}
        {activeTab === "fvg" && <FVGPage />}
        {activeTab === "liquidity" && <LiquidityPage />}
      </div>
    </div>
  );
}
