import { RoutineTodayScreen } from '../../../src/components/routine/RoutineTodayScreen';
import { TabScreenTransition } from '../../../src/components/navigation/TabScreenTransition';

export default function RoutineTabScreen() {
  return <TabScreenTransition><RoutineTodayScreen showBackButton={false} /></TabScreenTransition>;
}
