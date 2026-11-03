'use client';

import { BloodBankAuditEvent, BloodInventoryUnit, BloodBankMetrics } from '@/lib/blood-bank/types';
import { BLOOD_GROUPS, BLOOD_COMPONENTS, CLINICAL_SAFETY_DISCLAIMER } from '@/lib/blood-bank/constants';

interface ReportsTabProps {
  auditLogs: BloodBankAuditEvent[];
  inventory: BloodInventoryUnit[];
  metrics?: BloodBankMetrics;
}

export default function ReportsTab({ auditLogs, inventory }: ReportsTabProps) {
  // Create blood group vs component breakdown matrix
  const matrix: Record<string, Record<string, number>> = {};
  BLOOD_GROUPS.forEach((bg) => {
    matrix[bg] = {};
    BLOOD_COMPONENTS.forEach((c) => {
      matrix[bg][c.type] = 0;
    });
  });

  inventory.forEach((u) => {
    if (matrix[u.bloodGroup] && matrix[u.bloodGroup][u.componentType] !== undefined) {
      if (u.status === 'available') {
        matrix[u.bloodGroup][u.componentType]++;
      }
    }
  });

  return (
    <div className="space-y-6">
      {/* Regulatory Certification Notice */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-md">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <div className="flex items-center gap-2 text-rose-400 text-xs font-bold uppercase tracking-wider">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              Standard Regulatory Compliance Certification
            </div>
            <h3 className="text-lg font-bold mt-1">Audit Trail & Blood Product Traceability</h3>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Every donor registration, collection draw, screening outcome, inventory transition, and distribution dispatch is recorded with an immutable cryptographic audit record.
            </p>
          </div>
          <div className="bg-slate-800 border border-slate-700 px-4 py-2.5 rounded-xl text-center shrink-0">
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Audit Records</div>
            <div className="text-xl font-bold text-white mt-0.5">{auditLogs.length}</div>
          </div>
        </div>
      </div>

      {/* Inventory Breakdown by Blood Group & Component */}
      <div className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
        <h4 className="text-sm font-semibold text-slate-900 mb-1">
          Available Inventory Matrix (Units by Component & Group)
        </h4>
        <p className="text-xs text-slate-500 mb-4">
          Real-time count of physically tested and available blood units.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-100">
                <th className="py-2.5 px-3">Blood Group</th>
                {BLOOD_COMPONENTS.map((c) => (
                  <th key={c.type} className="py-2.5 px-3 text-center">
                    {c.label.split(' ')[0]}
                  </th>
                ))}
                <th className="py-2.5 px-3 text-center font-bold">Total Available</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {BLOOD_GROUPS.map((bg) => {
                let rowTotal = 0;
                return (
                  <tr key={bg} className="hover:bg-slate-50/60">
                    <td className="py-2.5 px-3 font-bold text-rose-700">{bg}</td>
                    {BLOOD_COMPONENTS.map((c) => {
                      const count = matrix[bg]?.[c.type] || 0;
                      rowTotal += count;
                      return (
                        <td key={c.type} className="py-2.5 px-3 text-center text-slate-700 font-mono">
                          {count === 0 ? <span className="text-slate-300">0</span> : count}
                        </td>
                      );
                    })}
                    <td className="py-2.5 px-3 text-center font-bold text-slate-900 bg-slate-50/50">
                      {rowTotal}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Logs Table */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Recent Immutable Audit Logs</h4>
            <p className="text-xs text-slate-500">Append-only operational event trail</p>
          </div>
          <span className="text-xs font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
            Latest {auditLogs.length} events
          </span>
        </div>

        {auditLogs.length === 0 ? (
          <div className="text-center py-12 px-4">
            <p className="text-xs text-slate-500 font-medium">No audit events recorded yet.</p>
            <p className="text-xs text-slate-400 mt-0.5">Events are automatically appended on state mutations.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-100">
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Actor</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Entity</th>
                  <th className="py-2.5 px-4">Entity ID</th>
                  <th className="py-2.5 px-4">Transition / Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50/60 font-mono text-[11px]">
                    <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                      {log.timestamp.replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-3 px-4 text-slate-700">
                      {log.actorEmail || log.actorUid.slice(0, 10)}
                    </td>
                    <td className="py-3 px-4 font-bold text-rose-700">{log.action}</td>
                    <td className="py-3 px-4 capitalize text-slate-700">{log.entity}</td>
                    <td className="py-3 px-4 text-slate-600">{log.entityId}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {log.statusTransition ? (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-800">
                          {log.statusTransition.from} → {log.statusTransition.to}
                        </span>
                      ) : log.details ? (
                        <span className="text-slate-500 truncate max-w-xs block">
                          {JSON.stringify(log.details)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Safety Notice Footer */}
      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 leading-relaxed">
        <strong>Mandatory Clinical Protocol:</strong> {CLINICAL_SAFETY_DISCLAIMER}
      </div>
    </div>
  );
}
