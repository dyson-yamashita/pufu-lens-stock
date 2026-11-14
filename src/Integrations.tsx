import { useEffect, useRef, type ReactNode } from 'react';
import { t, useLanguage } from './i18n';
import McpConnections from './McpConnections';
import XIntegration from './XIntegration';

const integrationTabs = ['shortcuts', 'mcp', 'sns'] as const;
export type IntegrationTab = (typeof integrationTabs)[number];

export function isIntegrationTab(view: string): view is IntegrationTab {
  return integrationTabs.some((tab) => tab === view);
}

export default function Integrations({
  tab,
  onSelect,
  children,
}: {
  tab: IntegrationTab;
  onSelect: (tab: IntegrationTab) => void;
  children: ReactNode;
}) {
  useLanguage();
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tabsRef.current?.contains(document.activeElement))
      document.getElementById(`integration-tab-${tab}`)?.focus();
  }, [tab]);
  const labels = { shortcuts: t('ui.app.shortcuts'), mcp: 'MCP', sns: 'SNS' };
  return (
    <div className="integrations-page">
      <div
        ref={tabsRef}
        className="detail-tabs integration-tabs"
        role="tablist"
        aria-label={t('ui.app.integrations')}
        onKeyDown={(event) => {
          if (
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
          )
            return;
          event.preventDefault();
          const index = integrationTabs.indexOf(tab);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? integrationTabs.length - 1
                : (index + (event.key === 'ArrowRight' ? 1 : -1) + integrationTabs.length) %
                  integrationTabs.length;
          const nextTab = integrationTabs[next];
          onSelect(nextTab);
          document.getElementById(`integration-tab-${nextTab}`)?.focus();
        }}
      >
        {integrationTabs.map((value) => (
          <button
            key={value}
            id={`integration-tab-${value}`}
            type="button"
            role="tab"
            className={tab === value ? 'active' : ''}
            aria-selected={tab === value}
            aria-controls="integration-panel"
            tabIndex={tab === value ? 0 : -1}
            onClick={() => onSelect(value)}
          >
            {labels[value]}
          </button>
        ))}
      </div>
      <div
        id="integration-panel"
        role="tabpanel"
        aria-labelledby={`integration-tab-${tab}`}
        tabIndex={0}
      >
        {tab === 'mcp' ? (
          <McpConnections />
        ) : tab === 'sns' ? (
          <div className="shortcuts-page">
            <h2 className="integration-heading">{t('ui.mcp_connections.x_api_integration')}</h2>
            <XIntegration />
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
