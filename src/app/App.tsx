import { ProjectFootprints } from '../features/footprints/ProjectFootprints';
import { ArrowLeft, BookOpen, Check } from 'lucide-react';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { Stock, User } from '../../shared/domain';
import { feedbackScreens, type FeedbackScreen } from '../../shared/feedback';
import { BootMessage } from '../components/BootMessage';
import { Brand } from '../components/Brand';
import { Spinner } from '../components/Spinner';
import Announcements from '../features/announcements/Announcements';
import { Login } from '../features/auth/Login';
import Onboarding from '../features/auth/Onboarding';
import type { useAppSession } from '../features/auth/useAppSession';
import '../styles/styles.css';
import FeedbackSurface from '../features/feedback/FeedbackSurface';
import Integrations, { isIntegrationTab } from '../features/integrations/Integrations';
import { Shortcuts } from '../features/integrations/Shortcuts';
import LegalLinks from '../features/legal/LegalLinks';
import { MemoryPanel } from '../features/memory/MemoryPanel';
import { ProjectForm } from '../features/projects/ProjectForm';
import PufuPage from '../features/pufu/PufuPage';
import Pufus from '../features/pufu/Pufus';
import QuestionPage from '../features/questions/QuestionPage';
import Questions from '../features/questions/Questions';
import { PublicationViewDetails } from '../features/public-projects/PublicationViewDetails';
import Profile from '../features/settings/Profile';
import { StockDetail } from '../features/stocks/StockDetail';
import { StockList } from '../features/stocks/StockList';
import type { SavedStock } from '../features/stocks/types';
import { applicationError, applyAccountLanguage, t, useLanguage } from '../i18n/i18n';
import { api, send } from '../lib/api';
import { AppBreadcrumbs } from './AppBreadcrumbs';
import { AppLibraryTabs } from './AppLibraryTabs';
import { AppModals } from './AppModals';
import { AppPageHeader } from './AppPageHeader';
import { AppSidebar } from './AppSidebar';
import type { ModalState } from './types';
import { useAppData } from './useAppData';
import { useAppLayout } from './useAppLayout';
import { useAppNavigation } from './useAppNavigation';

export default function App({
  session,
  error,
  setError,
}: {
  session: ReturnType<typeof useAppSession>;
  error: string;
  setError: Dispatch<SetStateAction<string>>;
}) {
  useLanguage();
  const [modal, setModal] = useState<ModalState>(null);
  const [creatingPufu, setCreatingPufu] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [stockSource, setStockSource] = useState('all');
  const [page, setPage] = useState(1);
  const [questionCreation, setQuestionCreation] = useState(0);
  const [notice, setNotice] = useState<{ message: string; stock?: SavedStock } | null>(null);
  const layout = useAppLayout(() => setPage(1));
  const navigation = useAppNavigation({
    resetPage: () => setPage(1),
    resetFilters: () => {
      setPage(1);
      setQuery('');
      setSearch('');
      setStockSource('all');
    },
    closeNavigation: () => layout.setMobileNav(false),
    closeModal: () => setModal(null),
  });
  const data = useAppData({
    session,
    navigation,
    filters: { search, stockSource, page, pageSize: layout.pageSize, setPage },
    setError,
  });
  const { config, user, setUser } = session;
  const {
    mobileNav,
    setMobileNav,
    desktopNavCollapsed,
    setDesktopNavCollapsed,
    isMobile,
    pageSize,
    sidebarOpen,
  } = layout;
  const {
    route,
    stockOrigin,
    openedStock,
    stockError,
    pufuSource,
    questionListContext,
    libraryProjectId,
    questionFlow,
    stockFlow,
    detailFlow,
    allQuestionsActive,
    allPufusActive,
    libraryView,
    listProjectId,
    filterProject,
    navigateDetail,
    openQuestion,
    openStock,
    backFromStock,
    backFromPufu,
    openPufu,
    navigate,
    restoreStockScroll,
    setNavigationGuard,
  } = navigation;
  const {
    refresh,
    projects,
    applyProjectSettings,
    stocks,
    savingStockFavorites,
    memoryResponse,
    tokens,
    total,
    loading,
    reload,
    toggleStockFavorite,
    renameStock,
    evidence,
  } = data;
  const firstStepsDone: [boolean, boolean, boolean] = [
    projects.length > 0,
    projects.some((project) => project.count > 0),
    projects.some((project) => project.user_question_count > 0),
  ];

  const showFirstSteps =
    !loading && !error && !search && stockSource === 'all' && firstStepsDone.some((done) => !done);

  const selected = projects.find((project) => project.id === route.projectId);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const completed = (message: string, stock?: SavedStock) => {
    setModal(null);
    setNotice({ message, stock });
    reload();
  };

  if (!config || user === undefined)
    return (
      <div className="boot">
        <Brand />
        {error ? <p role="status">{error}</p> : <BootMessage />}
      </div>
    );

  if (!user)
    return (
      <Login
        config={config}
        onLogin={async () => {
          await send('/api/auth/demo');
          const data = await api<{
            user: User;
          }>('/api/v1/me');
          applyAccountLanguage(data.user);
          setUser(data.user);
        }}
      />
    );

  if (!user.onboarding_completed_at)
    return (
      <Onboarding
        onComplete={(savedUser) => {
          applyAccountLanguage(savedUser);
          setUser(savedUser);
        }}
        onLogout={() => setUser(null)}
      />
    );

  const integrationTab = isIntegrationTab(route.view) ? route.view : null;

  const listLabel =
    questionListContext.view === 'pufus' ? t('ui.app.pufu') : t('ui.app.questions_insights');

  const feedbackScreen: FeedbackScreen =
    route.view === 'pufu'
      ? 'pufu-editor'
      : feedbackScreens.includes(route.view as FeedbackScreen)
        ? (route.view as FeedbackScreen)
        : 'app';

  return (
    <div className={`app-shell ${!isMobile && desktopNavCollapsed ? 'sidebar-collapsed' : ''}`}>
      <FeedbackSurface key={user.id} screen={feedbackScreen} />
      {isMobile && mobileNav && (
        <button
          className="nav-scrim"
          aria-label={t('ui.app.close_menu')}
          onClick={() => setMobileNav(false)}
        />
      )}
      <AppSidebar
        projects={projects}
        mobileNav={mobileNav}
        sidebarOpen={sidebarOpen}
        isMobile={isMobile}
        setMobileNav={setMobileNav}
        setDesktopNavCollapsed={setDesktopNavCollapsed}
        route={route}
        filterProject={filterProject}
        navigate={navigate}
        allQuestionsActive={allQuestionsActive}
        allPufusActive={allPufusActive}
        setModal={setModal}
        integrationTab={integrationTab}
        user={user}
        config={config}
        setUser={setUser}
        setError={setError}
      />
      <main className="workspace" inert={isMobile && mobileNav}>
        <AppBreadcrumbs
          projects={projects}
          questionListContext={questionListContext}
          stockFlow={stockFlow}
          route={route}
          listLabel={listLabel}
          stockOrigin={stockOrigin}
          questionFlow={questionFlow}
          isMobile={isMobile}
          sidebarOpen={sidebarOpen}
          setMobileNav={setMobileNav}
          setDesktopNavCollapsed={setDesktopNavCollapsed}
          detailFlow={detailFlow}
        />
        {config.demo && (
          <div className="demo-banner">
            <BookOpen size={15} aria-hidden="true" />
            <span>
              {config.aiEnabled
                ? t('ui.app.local_demo_includes_sample_articles_new_ai_generation_uses')
                : t('ui.app.local_demo_includes_sample_articles_without_ai_new_summaries')}
            </span>
          </div>
        )}
        <div className="page-body">
          {!detailFlow && (
            <AppPageHeader
              selected={selected}
              route={route}
              integrationTab={integrationTab}
              libraryView={libraryView}
              libraryProjectId={libraryProjectId}
              filterProject={filterProject}
              projects={projects}
              setModal={setModal}
            />
          )}
          {(route.view === 'stocks' ||
            route.view === 'questions' ||
            route.view === 'pufus' ||
            route.view === 'settings' ||
            route.view === 'memory') && <AppLibraryTabs route={route} navigate={navigate} />}
          {notice && (
            <div className="toast" role="status">
              <Check size={18} aria-hidden="true" />
              <span>{notice.message}</span>
              {notice.stock &&
                projects.some((project) => project.id === notice.stock!.projectId) && (
                  <>
                    <span>{t('first_steps.after_save')}</span>
                    <button
                      className="button secondary"
                      onClick={() =>
                        setModal({
                          type: 'question',
                          projectId: notice.stock!.projectId,
                          stock: { id: notice.stock!.id, label: notice.stock!.label },
                        })
                      }
                    >
                      {t('ui.app.add_question_or_insight')}
                    </button>
                  </>
                )}
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button className="button text-button" onClick={reload}>
                {t('ui.app.reload')}
              </button>
            </div>
          )}
          {(route.view === 'questions' ||
            (questionFlow && questionListContext.view === 'questions') ||
            (stockFlow &&
              (stockOrigin.hash.startsWith('#questions') ||
                stockOrigin.hash.startsWith('#question/')))) && (
            <div hidden={route.view !== 'questions'}>
              <Questions
                projects={projects}
                onAdd={() => setModal({ type: projects.length ? 'question' : 'project' })}
                key={`${(stockFlow ? stockOrigin.projectId : questionFlow ? questionListContext.projectId : route.projectId) ?? 'all'}-${questionCreation}`}
                active={route.view === 'questions'}
                isMobile={isMobile}
                projectId={
                  stockFlow
                    ? stockOrigin.scope
                    : questionFlow
                      ? questionListContext.scope
                      : listProjectId
                }
                refresh={refresh}
                onQuestion={openQuestion}
                onScope={(id) => {
                  if (libraryView) filterProject(id);
                  else navigate('questions', id);
                }}
                onOpen={async (id, tab = 'question') => {
                  const { stock } = await api<{
                    stock: Stock;
                  }>(`/api/v1/stocks/${encodeURIComponent(id)}`);
                  openStock(stock, tab);
                }}
              />
            </div>
          )}
          {(route.view === 'pufus' || (questionFlow && questionListContext.view === 'pufus')) && (
            <div hidden={route.view !== 'pufus'}>
              <Pufus
                key={(questionFlow ? questionListContext.projectId : route.projectId) ?? 'all'}
                projectId={questionFlow ? questionListContext.scope : listProjectId}
                active={route.view === 'pufus'}
                refresh={refresh}
                onPufu={openPufu}
              />
            </div>
          )}
          {stockFlow ? (
            <section className="stock-detail-page" aria-label={t('stock.detail_title')}>
              <button className="back-link" onClick={backFromStock}>
                <ArrowLeft size={16} aria-hidden="true" />
                {t('stock.back')}
              </button>
              <header className="page-header">
                <div>
                  <h1>{t('stock.detail_title')}</h1>
                  <p>{t('stock.detail_description')}</p>
                </div>
              </header>
              {stockError && (
                <p className="form-error" role="alert">
                  {stockError}
                  <button className="button text-button" onClick={reload}>
                    {t('ui.app.reload')}
                  </button>
                </p>
              )}
              {openedStock && openedStock.id === route.detailId ? (
                <div className="stock-detail-card">
                  <StockDetail
                    key={openedStock.id}
                    stock={openedStock}
                    projects={projects}
                    initialTab={stockOrigin.tab}
                    onDone={completed}
                    onQuestion={openQuestion}
                    onDeleted={(message) => {
                      completed(message);
                      backFromStock();
                    }}
                    favoriteBusy={savingStockFavorites.includes(openedStock.id)}
                    onFavorite={toggleStockFavorite}
                    onRename={renameStock}
                  />
                </div>
              ) : (
                !stockError && (
                  <p className="content-loading">
                    <Spinner />
                    {t('ui.app.loading_articles')}
                  </p>
                )
              )}
            </section>
          ) : questionFlow ? (
            route.view === 'pufu' ? (
              <PufuPage
                key={route.detailId}
                id={route.detailId!}
                onQuestion={(id) => navigateDetail('question', id)}
                backLabel={
                  pufuSource.questionId
                    ? t('ui.app.back_to_question_or_insight')
                    : t('ui.app.back_to_pufu_list')
                }
                onBack={backFromPufu}
                onGuard={setNavigationGuard}
                onDeleted={() => {
                  setNotice({ message: t('ui.pufu_page.pufu_deleted') });
                  reload();
                  backFromPufu();
                }}
              />
            ) : (
              <QuestionPage
                key={route.detailId}
                id={route.detailId!}
                projects={projects}
                resolve={route.view === 'resolve'}
                onUpdated={reload}
                onLoaded={restoreStockScroll}
                backLabel={t('ui.app.back_to_value_list', { value0: listLabel })}
                onBack={() => {
                  if (route.view === 'resolve') navigateDetail('question', route.detailId!);
                  else window.location.hash = questionListContext.hash;
                }}
                onResolve={() => navigateDetail('resolve', route.detailId!)}
                onPufu={(id) => navigateDetail('pufu', id)}
                onDeleted={() => {
                  setNotice({ message: t('ui.app.question_or_insight_deleted') });
                  reload();
                  window.location.hash = questionListContext.hash;
                }}
                onStock={async (id) => {
                  const { stock } = await api<{
                    stock: Stock;
                  }>(`/api/v1/stocks/${encodeURIComponent(id)}`);
                  openStock(stock);
                }}
              />
            )
          ) : route.view === 'settings' ? (
            <section className="project-settings" aria-label={t('ui.app.project_settings')}>
              {selected ? (
                <ProjectForm
                  key={selected.id}
                  project={selected}
                  onDone={(id, settings) => {
                    applyProjectSettings(id, settings);
                    completed(t('ui.app.project_settings_saved'));
                  }}
                  onDelete={() => {
                    completed(t('ui.app.project_deleted'));
                    filterProject(null);
                    navigate('stocks');
                  }}
                />
              ) : (
                <p className="content-loading">
                  <Spinner />
                  {t('ui.app.loading_project')}
                </p>
              )}
            </section>
          ) : route.view === 'public-views' && route.projectId ? (
            <PublicationViewDetails
              key={route.projectId}
              projectId={route.projectId}
              isMobile={isMobile}
            />
          ) : route.view === 'questions' || route.view === 'pufus' ? null : route.view ===
            'profile' ? (
            <Profile
              user={user}
              onSave={(savedUser) => {
                applyAccountLanguage(savedUser);
                setUser(savedUser);
                setNotice({ message: t('ui.app.profile_saved') });
              }}
            />
          ) : route.view === 'announcements' ? (
            <Announcements key={route.detailId ?? 'list'} id={route.detailId} />
          ) : integrationTab ? (
            <Integrations tab={integrationTab} onSelect={navigate}>
              <Shortcuts
                baseUrl={config?.appUrl ?? window.location.origin}
                projects={projects}
                tokens={tokens}
                onCreate={() => setModal({ type: 'token' })}
                onRevoke={async (id) => {
                  try {
                    await api(`/api/v1/tokens/${id}`, { method: 'DELETE' });
                    setNotice({ message: t('ui.app.token_revoked') });
                    reload();
                  } catch (e) {
                    setError(applicationError((e as Error).message));
                  }
                }}
              />
            </Integrations>
          ) : route.view === 'memory' ? (
            <div className="memory-page">
              {route.projectId && selected?.include_in_user_memory && (
                <ProjectFootprints
                  key={`footprints-${route.projectId}`}
                  projectId={route.projectId}
                  memoryRevision={memoryResponse.memory?.revision}
                />
              )}
              <MemoryPanel
                key={route.projectId ?? 'user'}
                historyProjectId={route.projectId ?? undefined}
                response={memoryResponse}
                project={selected}
                full
                onEvidence={evidence}
                onRebuild={() => setModal({ type: 'memory', projectId: route.projectId })}
              />
            </div>
          ) : (
            <div className="content-layout">
              <StockList
                query={query}
                search={search}
                setQuery={setQuery}
                setSearch={setSearch}
                setPage={setPage}
                reload={reload}
                stockSource={stockSource}
                setStockSource={setStockSource}
                total={total}
                showFirstSteps={showFirstSteps}
                firstStepsDone={firstStepsDone}
                setModal={setModal}
                listProjectId={listProjectId}
                projects={projects}
                loading={loading}
                stocks={stocks}
                openStock={openStock}
                savingStockFavorites={savingStockFavorites}
                toggleStockFavorite={toggleStockFavorite}
                setError={setError}
                pageSize={pageSize}
                page={page}
                isMobile={isMobile}
              />
              <aside className="memory-aside">
                <MemoryPanel response={memoryResponse} project={selected} onEvidence={evidence} />
              </aside>
            </div>
          )}
          {(route.view === 'stocks' ||
            route.view === 'questions' ||
            route.view === 'pufus' ||
            route.view === 'memory') && (
            <footer className="library-footer">
              <LegalLinks newTab />
            </footer>
          )}
        </div>
      </main>
      <AppModals
        modal={modal}
        setModal={setModal}
        projects={projects}
        applyProjectSettings={applyProjectSettings}
        completed={completed}
        navigate={navigate}
        listProjectId={listProjectId}
        firstStepsDone={firstStepsDone}
        setQuestionCreation={setQuestionCreation}
        route={route}
        libraryProjectId={libraryProjectId}
        filterProject={filterProject}
        creatingPufu={creatingPufu}
        setCreatingPufu={setCreatingPufu}
        openPufu={openPufu}
        reload={reload}
      />
    </div>
  );
}
