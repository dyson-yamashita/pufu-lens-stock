import type { Dispatch, SetStateAction } from 'react';
import type { Project } from '../../shared/domain';
import { Modal } from '../components/Modal';
import { TokenForm } from '../features/integrations/TokenForm';
import MemoryRebuildForm from '../features/memory/MemoryRebuildForm';
import { ProjectForm, type ProjectSettings } from '../features/projects/ProjectForm';
import PufuForm from '../features/pufu/PufuForm';
import PufuModal from '../features/pufu/PufuModal';
import QuestionForm from '../features/questions/QuestionForm';
import { SaveForm } from '../features/stocks/SaveForm';
import type { SavedStock } from '../features/stocks/types';
import { t } from '../i18n/i18n';
import type { Route } from './navigation';
import type { ModalState } from './types';

type Props = {
  modal: ModalState;
  setModal: Dispatch<SetStateAction<ModalState>>;
  projects: Project[];
  applyProjectSettings: (id: string, settings: ProjectSettings) => void;
  completed: (message: string, stock?: SavedStock | undefined) => void;
  navigate: (
    view:
      | 'memory'
      | 'stocks'
      | 'stock'
      | 'shortcuts'
      | 'mcp'
      | 'sns'
      | 'announcements'
      | 'profile'
      | 'questions'
      | 'pufus'
      | 'settings'
      | 'question'
      | 'resolve'
      | 'pufu',
    projectId?: string | null,
  ) => void;
  listProjectId: string | null;
  firstStepsDone: [boolean, boolean, boolean];
  setQuestionCreation: Dispatch<SetStateAction<number>>;
  route: Route;
  libraryProjectId: string | null;
  filterProject: (projectId: string | null) => void;
  creatingPufu: boolean;
  setCreatingPufu: Dispatch<SetStateAction<boolean>>;
  openPufu: (id: string) => void;
  reload: () => void;
};
export function AppModals({
  modal,
  setModal,
  projects,
  applyProjectSettings,
  completed,
  navigate,
  listProjectId,
  firstStepsDone,
  setQuestionCreation,
  route,
  libraryProjectId,
  filterProject,
  creatingPufu,
  setCreatingPufu,
  openPufu,
  reload,
}: Props) {
  return (
    <>
      {modal?.type === 'memory' && (
        <Modal title={t('ui.app.how_to_update_memory')} onClose={() => setModal(null)}>
          <MemoryRebuildForm
            projectId={modal.projectId}
            projectName={projects.find((project) => project.id === modal.projectId)?.name}
            onClose={() => setModal(null)}
            onDone={() => completed(t('ui.app.memory_update_accepted'))}
          />
        </Modal>
      )}
      {modal?.type === 'project' && (
        <Modal
          title={modal.project ? t('ui.app.edit_project') : t('ui.app.new_project')}
          onClose={() => setModal(null)}
        >
          <ProjectForm
            project={modal.project}
            onDone={(id, settings) => {
              if (modal.project) applyProjectSettings(id, settings);
              completed(modal.project ? t('ui.app.project_updated') : t('ui.app.project_created'));
              navigate('stocks', id);
            }}
            onDelete={() => {
              completed(t('ui.app.project_deleted'));
              navigate('stocks');
            }}
          />
        </Modal>
      )}
      {modal?.type === 'save' && (
        <Modal title={t('ui.app.save_article')} onClose={() => setModal(null)}>
          <SaveForm
            projects={projects}
            projectId={listProjectId}
            onDone={(duplicate, youtube, stock) =>
              completed(
                youtube
                  ? t('ui.app.youtube_url_saved')
                  : duplicate
                    ? t('ui.app.this_article_is_already_saved')
                    : t('ui.app.article_saved_its_summary_will_be_generated_automatically'),
                !duplicate && !firstStepsDone[2] ? stock : undefined,
              )
            }
          />
        </Modal>
      )}
      {modal?.type === 'question' && (
        <Modal title={t('ui.app.add_question_or_insight')} onClose={() => setModal(null)}>
          <QuestionForm
            projects={projects}
            projectId={modal.projectId ?? listProjectId}
            initialStock={modal.stock}
            onDone={(projectId) => {
              completed(t('ui.app.question_or_insight_added'));
              setQuestionCreation((value) => value + 1);
              if (route.projectId) navigate('questions', projectId);
              else if (libraryProjectId) filterProject(projectId);
            }}
          />
        </Modal>
      )}
      {modal?.type === 'pufu' && (
        <PufuModal
          title={t('ui.app.add_pufu')}
          wide={false}
          busy={creatingPufu}
          onClose={() => setModal(null)}
        >
          <PufuForm
            projects={projects}
            projectId={listProjectId}
            onBusyChange={setCreatingPufu}
            onDone={openPufu}
          />
        </PufuModal>
      )}
      {modal?.type === 'token' && (
        <Modal
          title={t('ui.app.create_shortcut_token')}
          onClose={() => {
            setModal(null);
            reload();
          }}
        >
          <TokenForm projects={projects} />
        </Modal>
      )}
    </>
  );
}
