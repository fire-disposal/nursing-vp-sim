import CheckboxGroupItem from "./CheckboxGroupItem";
import CompoundItem from "./CompoundItem";
import InputItem from "./InputItem";
import RadioItem from "./RadioItem";
import RepeaterItem from "./RepeaterItem";
import SelectItem from "./SelectItem";
import TextareaItem from "./TextareaItem";
import VitalSignItem from "./VitalSignItem";

export const ITEM_COMPONENTS: Record<string, React.ComponentType<any>> = {
	input: InputItem,
	textarea: TextareaItem,
	select: SelectItem,
	radio: RadioItem,
	checkbox_group: CheckboxGroupItem,
	vital_sign: VitalSignItem,
	compound: CompoundItem,
	repeater: RepeaterItem,
};
