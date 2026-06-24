import { moveMouse, performClick, performKeyPress, performType } from './actions.js';
import { writeMCPLog } from '../mcp-logger.js';
import { locateGUIElement } from './vision-plan-locate.js';

export async function executeActionStep(
  step: { step: number; action: string; element_description: string; value?: string },
  displayIndex?: number
): Promise<{
  success: boolean;
  step: number;
  action: string;
  coordinates?: { x: number; y: number };
  error?: string;
}> {
  try {
    writeMCPLog(
      `[executeActionStep] Starting step ${step.step}: ${step.action} on "${step.element_description}"`,
      'Step Execution'
    );

    const coords = await locateGUIElement(step.element_description, displayIndex);
    writeMCPLog(
      `[executeActionStep] Step ${step.step}: Located element at (${coords.x}, ${coords.y}) with confidence ${coords.confidence}%`,
      'Step Execution'
    );

    if (coords.confidence < 50) {
      writeMCPLog(
        `[executeActionStep] Step ${step.step}: Low confidence (${coords.confidence}%), aborting`,
        'Step Execution'
      );
      return {
        success: false,
        step: step.step,
        action: step.action,
        error: `Element "${step.element_description}" not found with sufficient confidence (${coords.confidence}%)`,
      };
    }

    writeMCPLog(
      `[executeActionStep] Step ${step.step}: Executing action "${step.action}"`,
      'Step Execution'
    );
    switch (step.action) {
      case 'click':
        await performClick(coords.x, coords.y, coords.displayIndex, 'single');
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Click completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'click',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'double_click':
        await performClick(coords.x, coords.y, coords.displayIndex, 'double');
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Double click completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'double_click',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'right_click':
        await performClick(coords.x, coords.y, coords.displayIndex, 'right');
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Right click completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'right_click',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'type':
        if (!step.value) {
          writeMCPLog(
            `[executeActionStep] Step ${step.step}: Type action missing value`,
            'Step Execution Error'
          );
          return {
            success: false,
            step: step.step,
            action: 'type',
            error: 'Value is required for type action',
          };
        }
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Clicking to focus, then typing "${step.value}"`,
          'Step Execution'
        );
        await performClick(coords.x, coords.y, coords.displayIndex, 'single');
        await new Promise((resolve) => setTimeout(resolve, 200));
        await performType(step.value, false);
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Type completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'type',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'hover':
        await moveMouse(coords.x, coords.y, coords.displayIndex);
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Hover completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'hover',
          coordinates: { x: coords.x, y: coords.y },
        };

      case 'key_press':
        if (!step.value) {
          writeMCPLog(
            `[executeActionStep] Step ${step.step}: Key press action missing key name`,
            'Step Execution Error'
          );
          return {
            success: false,
            step: step.step,
            action: 'key_press',
            error: 'Key name is required for key_press action',
          };
        }
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Pressing key "${step.value}"`,
          'Step Execution'
        );
        await performKeyPress(step.value, []);
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Key press completed successfully`,
          'Step Execution'
        );
        return {
          success: true,
          step: step.step,
          action: 'key_press',
        };

      default:
        writeMCPLog(
          `[executeActionStep] Step ${step.step}: Unsupported action "${step.action}"`,
          'Step Execution Error'
        );
        return {
          success: false,
          step: step.step,
          action: step.action,
          error: `Unsupported action: ${step.action}`,
        };
    }
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const errStack = error instanceof Error ? error.stack : undefined;

    writeMCPLog(
      `[executeActionStep] Step ${step.step}: Error occurred: ${errMsg}`,
      'Step Execution Error'
    );
    writeMCPLog(
      `[executeActionStep] Step ${step.step}: Error stack: ${errStack}`,
      'Step Execution Error'
    );

    return {
      success: false,
      step: step.step,
      action: step.action,
      error: errMsg,
    };
  }
}
