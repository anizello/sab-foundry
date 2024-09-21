import { removeFatigueItems } from "./sheet.mjs";

/**
 * Performs an attribute save roll for a character.
 * @async
 * @param {object} dataset The dataset containing roll information.
 * @param {string} dataset.attribute The attribute being rolled (e.g., 'body', 'mind', 'luck').
 * @param {string} dataset.roll The roll formula.
 * @param {Actor} actor The actor performing the roll.
 * @returns {Promise<ChatMessage>} A promise that resolves to the created chat message.
 */
export async function AttributeSaveRoll(dataset, actor) {
  const chatTemplate = "systems/spellburn-and-battlescars/templates/chat/attribute-save.hbs";

  let attribute = dataset.attribute ? dataset.attribute : "";
  let roll = new Roll(dataset.roll, actor.getRollData());
  await roll.evaluate();

  const rollData = {
    speaker: ChatMessage.getSpeaker({ actor: actor }),
    rollMode: game.settings.get("core", "rollMode")
  };

  if (checkCriticalFailure(roll.total)) {
    actor.update({
      "system.attributes.luck.value": actor.system.attributes.luck.value - 1
    });

    return roll.toMessage({
      ...rollData,
      flavor: await renderTemplate(chatTemplate, {
        type: "critical-failure",
        message: game.i18n.localize("SAB.chat.critical-failure")
      })
    });
  }

  if (checkCriticalSuccess(roll.total, attribute, roll.data)) {
    actor.update({
      "system.attributes.luck.value": actor.system.attributes.luck.value + 1
    });

    return roll.toMessage({
      ...rollData,
      flavor: await renderTemplate(chatTemplate, {
        type: "critical-success",
        message: game.i18n.localize("SAB.chat.critical-success")
      })
    });
  }

  if (checkSuccess(roll.total, attribute, roll.data)) {
    return roll.toMessage({
      ...rollData,
      flavor: await renderTemplate(chatTemplate, {
        type: "success",
        message: game.i18n.localize("SAB.chat.save-success")
      })
    });
  } else {
    return roll.toMessage({
      ...rollData,
      flavor: await renderTemplate(chatTemplate, {
        type: "failure",
        message: game.i18n.localize("SAB.chat.save-failure")
      })
    });
  }
}

/**
 * Performs a short rest roll for a character.
 * @async
 * @param {object} dataset The dataset containing roll information.
 * @param {string} dataset.roll The roll formula.
 * @param {Actor} actor The actor performing the roll.
 * @returns {Promise<ChatMessage>} A promise that resolves to the created chat message.
 */
export async function ShortRestRoll(dataset, actor) {
  const chatTemplate = "systems/spellburn-and-battlescars/templates/chat/default-message.hbs";

  let roll = new Roll(dataset.roll, actor.getRollData());
  await roll.evaluate();

  if (actor.system.attributes.isDeprived) {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: actor }),
      content: await renderTemplate(chatTemplate, {
        type: "deprived",
        message: game.i18n.localize("SAB.chat.deprived")
      })
    });
  }

  if (actor.system.health.value === actor.system.health.max) {
    return null;
  }

  const rollData = {
    speaker: ChatMessage.getSpeaker({ actor: actor }),
    rollMode: game.settings.get("core", "rollMode")
  };

  let hpNewValue = 0;
  let hpRecovered = 0;

  if (actor.system.health.value + roll.total > actor.system.health.max) {
    hpNewValue = actor.system.health.max;
    hpRecovered = hpNewValue - actor.system.health.value;
  } else {
    hpNewValue = actor.system.health.value + roll.total;
    hpRecovered = roll.total;
  }

  actor.update({
    "system.health.value": hpNewValue
  });

  return roll.toMessage({
    ...rollData,
    flavor: await renderTemplate(chatTemplate, {
      type: "short-rest",
      message: game.i18n.format("SAB.chat.short-rest", { value: hpRecovered })
    })
  });
}

/**
 * Handles the long rest roll for a character.
 * @async
 * @param {object} dataset The dataset containing roll information.
 * @param {Actor} actor The actor performing the long rest.
 * @param {string} attribute The attribute to recover ('body' or 'mind').
 * @returns {Promise<ChatMessage|null>} A promise that resolves to a ChatMessage or null.
 */
export async function LongRestRoll(dataset, actor, attribute) {
  const chatTemplate = "systems/spellburn-and-battlescars/templates/chat/default-message.hbs";

  let roll = new Roll(dataset.roll, actor.getRollData());
  await roll.evaluate();

  if (actor.system.attributes.isDeprived) {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: actor }),
      content: await renderTemplate(chatTemplate, {
        type: "deprived",
        message: game.i18n.localize("SAB.chat.deprived")
      })
    });
  }

  const rollData = {
    speaker: ChatMessage.getSpeaker({ actor: actor }),
    rollMode: game.settings.get("core", "rollMode")
  };

  let attributeRecovered = 0;

  const updateAttribute = (actor, attribute, roll) => {
    const currentValue = actor.system[attribute].value;
    const maxValue = actor.system[attribute].max;
    const newValue = Math.min(currentValue + roll.total, maxValue);
    const recovered = newValue - currentValue;

    return {
      recovered,
      updateData: {
        [`system.${attribute}.value`]: newValue,
        "system.health.value": actor.system.health.max
      }
    };
  };

  if (attribute === "body" || attribute === "mind") {
    const { recovered, updateData } = updateAttribute(actor, attribute, roll);
    attributeRecovered = recovered;
    actor.update(updateData);
  } else {
    console.warn(`Unexpected attribute: ${attribute}`);
  }

  removeFatigueItems(actor);

  if (attributeRecovered === 0) {
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: actor }),
      content: await renderTemplate(chatTemplate, {
        type: "long-rest",
        message: game.i18n.localize("SAB.chat.long-rest-no-attribute-recovery")
      })
    });
  }

  return roll.toMessage({
    ...rollData,
    flavor: await renderTemplate(chatTemplate, {
      type: "long-rest",
      message: game.i18n.format("SAB.chat.long-rest", { attribute: game.i18n.localize(`SAB.character.${attribute}.long`), value: attributeRecovered })
    })
  });
}


/**
 * Checks if a roll result is a critical failure.
 * @param {number} total The total result of the roll.
 * @returns {boolean} True if the roll is a critical failure, false otherwise.
 */
const checkCriticalFailure = total => {
  return total === 20;
};

/**
 * Checks if a roll result is a critical success.
 * @param {number} total The total result of the roll.
 * @param {string} attribute The attribute being rolled ('body', 'mind', or 'luck').
 * @param {object} data The actor's data object containing attribute values.
 * @param {object} data.body The body attribute object.
 * @param {number} data.body.value The current value of the body attribute.
 * @param {object} data.mind The mind attribute object.
 * @param {number} data.mind.value The current value of the mind attribute.
 * @param {object} data.attributes The attributes object.
 * @param {object} data.attributes.luck The luck attribute object.
 * @param {number} data.attributes.luck.value The current value of the luck attribute.
 * @returns {boolean} True if the roll is a critical success, false otherwise.
 */
const checkCriticalSuccess = (total, attribute, data) => {
  switch (attribute) {
    case "body":
      return total === data.body.value;
    case "mind":
      return total === data.mind.value;
    case "luck":
      return total === data.attributes.luck.value;
    default:
      return false;
  }
};

/**
 * Checks if a roll result is a success.
 * @param {number} total The total result of the roll.
 * @param {string} attribute The attribute being rolled ('body', 'mind', or 'luck').
 * @param {object} data The actor's data object containing attribute values.
 * @param {object} data.body The body attribute object.
 * @param {number} data.body.value The current value of the body attribute.
 * @param {object} data.mind The mind attribute object.
 * @param {number} data.mind.value The current value of the mind attribute.
 * @param {object} data.attributes The attributes object.
 * @param {object} data.attributes.luck The luck attribute object.
 * @param {number} data.attributes.luck.value The current value of the luck attribute.
 * @returns {boolean} True if the roll is a success, false otherwise.
 */
const checkSuccess = (total, attribute, data) => {
  switch (attribute) {
    case "body":
      return total < data.body.value;
    case "mind":
      return total < data.mind.value;
    case "luck":
      return total < data.attributes.luck.value;
    default:
      return false;
  }
};
