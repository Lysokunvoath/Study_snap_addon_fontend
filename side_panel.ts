import { meet } from '@googleworkspace/meet-addons/meet.addons';

const CLOUD_PROJECT_NUMBER: string = '980889141066';

declare global {
  interface Window {
    studySnapAddon: {
      setUpSidePanel: () => Promise<void>;
      initializeMainStage: () => Promise<void>;
    };
  }
}

function getCloudProjectNumber(): string {
  if (CLOUD_PROJECT_NUMBER === 'REPLACE_WITH_YOUR_CLOUD_PROJECT_NUMBER') {
    throw new Error(
      'Set CLOUD_PROJECT_NUMBER in side_panel.ts before running inside Meet.'
    );
  }

  return CLOUD_PROJECT_NUMBER;
}

function getDefaultMainStageUrl(): string {
  return new URL('./MainStage.html', window.location.href).toString();
}

export async function setUpSidePanel(): Promise<void> {
  const session = await meet.addon.createAddonSession({
    cloudProjectNumber: getCloudProjectNumber(),
  });

  const sidePanelClient = await session.createSidePanelClient();
  const startButton = document.getElementById('start-activity');

  if (!startButton) {
    throw new Error('Could not find #start-activity button in SidePanel.html');
  }

  startButton.addEventListener('click', async () => {
    await sidePanelClient.startActivity({
      mainStageUrl: getDefaultMainStageUrl(),
    });
  });
}

export async function initializeMainStage(): Promise<void> {
  const session = await meet.addon.createAddonSession({
    cloudProjectNumber: getCloudProjectNumber(),
  });

  await session.createMainStageClient();
}

window.studySnapAddon = {
  setUpSidePanel,
  initializeMainStage,
};
