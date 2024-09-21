import SabItemBase from "./base-item.mjs";

export default class SabItem extends SabItemBase {

  static defineSchema() {
    const fields = foundry.data.fields;
    const requiredInteger = { required: true, nullable: false, integer: true };
    const schema = super.defineSchema();

    // Add item type options
    schema.itemType = new fields.StringField({
      required: true,
      choices: ["weapon", "armor", "misc", "spell", "relic", "fatigue"],
      initial: "misc"
    });

    schema.quantity = new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 });
    schema.weight = new fields.NumberField({ ...requiredInteger, initial: 1});

    // Add armour value
    schema.armourValue = new fields.NumberField({ ...requiredInteger, initial: 0, min: 0 });

    // Break down roll formula into three independent fields
    schema.roll = new fields.SchemaField({
      diceNum: new fields.NumberField({ ...requiredInteger, initial: 1, min: 1 }),
      diceSize: new fields.StringField({ initial: "" }),
      diceBonus: new fields.StringField({ initial: "" })
    });

    schema.formula = new fields.StringField({ blank: true });

    return schema;
  }

  prepareDerivedData() {
    // Build the formula dynamically using string interpolation and max function
    const roll = this.roll;
    if (roll.diceBonus) {
      // Remove numbers before 'd', replace '+' with ',', ensure it starts with ',', and remove empty spaces
      roll.diceBonus = roll.diceBonus
        .replace(/\d+(?=d)/g, "")
        .replace(/\+/g, ",")
        .replace(/^(?!,)/, ",")
        .replace(/\s+/g, "");
    }

    if (roll.diceBonus) {
      this.formula = `{${roll.diceSize}${roll.diceBonus}}kh`;
    } else {
      this.formula = roll.diceSize;
    }
  }
}
