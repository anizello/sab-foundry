import {
  onManageActiveEffect,
  prepareActiveEffectCategories
} from "../helpers/effects.mjs";

import { clampAttribute, clampValue, removeFatigueItems } from "../helpers/sheet.mjs";
import * as SABRolls from "../helpers/rolls.mjs";

/**
 * Extend the basic ActorSheet with some very simple modifications
 * @extends {ActorSheet}
 */
export class SabActorSheet extends ActorSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["spellburn-and-battlescars", "sheet", "actor"],
      width: 800,
      height: 800,
      tabs: [
        {
          navSelector: ".sheet-tabs",
          contentSelector: ".sheet-body",
          initial: "items"
        }
      ]
    });
  }

  /** @override */
  get template() {
    return `systems/spellburn-and-battlescars/templates/actor/actor-${this.actor.type}-sheet.hbs`;
  }

  /* -------------------------------------------- */

  /** @override */
  async getData() {
    // Retrieve the data structure from the base sheet. You can inspect or log
    // the context variable to see the structure, but some key properties for
    // sheets are the actor object, the data object, whether or not it's
    // editable, the items array, and the effects array.
    const context = super.getData();

    // Use a safe clone of the actor data for further operations.
    const actorData = this.document.toPlainObject();

    // Add the actor's data to context.data for easier access, as well as flags.
    context.system = actorData.system;
    context.flags = actorData.flags;

    // Adding a pointer to CONFIG.SAB
    context.config = CONFIG.SAB;

    // Prepare character data and items.
    if (actorData.type === "character") {
      this._prepareItems(context);
      this._prepareCharacterData(context);
    }

    // Prepare NPC data and items.
    if (actorData.type === "npc") {
      this._prepareItems(context);
    }

    // Enrich biography info for display
    // Enrichment turns text like `[[/r 1d20]]` into buttons
    context.enrichedBiography = await TextEditor.enrichHTML(
      this.actor.system.biography,
      {
        // Whether to show secret blocks in the finished html
        secrets: this.document.isOwner,
        // Data to fill in for inline rolls
        rollData: this.actor.getRollData(),
        // Relative UUID resolution
        relativeTo: this.actor
      }
    );

    // Prepare active effects
    context.effects = prepareActiveEffectCategories(
      // A generator that returns all effects stored on the actor
      // as well as any items
      this.actor.allApplicableEffects()
    );

    return context;
  }

  /**
   * Character-specific context modifications
   *
   * @param {object} context The context object to mutate
   */
  _prepareCharacterData(context) {
    context.system.health = clampAttribute(
      context.system.health.value,
      context.system.health.max
    );
    context.system.body = clampAttribute(
      context.system.body.value,
      context.system.body.max
    );
    context.system.mind = clampAttribute(
      context.system.mind.value,
      context.system.mind.max
    );

    context.system.attributes.luck.value = clampValue(context.system.attributes.luck.value);
    context.system.ar.value = clampValue(context.system.ar.value, 0, 3);
  }

  /**
   * Organize and classify Items for Actor sheets.
   *
   * @param {object} context The context object to mutate
   */
  _prepareItems(context) {
    // Initialize containers.
    const gear = [];
    const features = [];
    const spells = [];

    // Iterate through items, allocating to containers
    for (let i of context.items) {
      i.img = i.img || Item.DEFAULT_ICON;
      // Append to gear.
      if (i.type === "item") {
        gear.push(i);
      }
      else if (i.type === "feature") {
        features.push(i);
      }
      // Append to spells.
      else if (i.type === "spell") {
        spells.push(i);
      }
    }

    // Sort items based on their sort value
    const sortItems = (a, b) => {
      if (a.sort === 0) return 1;
      if (b.sort === 0) return -1;

      return 0;
    };

    // Apply sorting to gear, features, and spells
    gear.sort(sortItems);
    features.sort(sortItems);
    spells.sort(sortItems);

    // Assign and return
    context.gear = gear;
    context.features = features;
    context.spells = spells;
  }

  /* -------------------------------------------- */

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);

    // Render the item sheet for viewing/editing prior to the editable check.
    html.on("click", ".item-edit", ev => {
      const li = $(ev.currentTarget).parents(".item");
      const item = this.actor.items.get(li.data("itemId"));
      item.sheet.render(true);
    });

    // -------------------------------------------------------------
    // Everything below here is only needed if the sheet is editable
    if (!this.isEditable) return;

    // Handle sheet rolls
    if (this.actor.isOwner) {
      html.on("click", ".attribute-save-roll", this._onAttributeSaveRoll.bind(this));
      html.on("click", ".short-rest-roll", this._onShortRestRoll.bind(this));
      html.on("click", ".long-rest-roll", this._onLongRestRoll.bind(this));
      html.on("click", ".full-rest-roll", this._onFullRest.bind(this));
    }

    // Add Inventory Item
    html.on("click", ".item-create", this._onItemCreate.bind(this));

    // Add Armor Modifiers
    html.find(".character-armor").click(this._onArmorConfig.bind(this));

    // Delete Inventory Item
    html.on("click", ".item-delete", ev => {
      const li = $(ev.currentTarget).parents(".item");
      const item = this.actor.items.get(li.data("itemId"));

      item.delete();
      li.slideUp(200, () => this.render(false));
    });

    // Active Effect management
    html.on("click", ".effect-control", ev => {
      const row = ev.currentTarget.closest("li");
      const document =
        row.dataset.parentId === this.actor.id
          ? this.actor
          : this.actor.items.get(row.dataset.parentId);
      onManageActiveEffect(ev, document);
    });

    // Item Quantity
    html.on("click", ".item-quantity-add", this._onItemQuantityAdd.bind(this));
    html.on("click", ".item-quantity-remove", this._onItemQuantityRemove.bind(this));

    // Remove Item Quantity

    // Rollable abilities.
    html.on("click", ".rollable", this._onRoll.bind(this));

    // Roll new character.
    html.on("click", ".roll-new-character", this._rollNewCharacter.bind(this));

    // Advance.
    html.on("click", ".advance-character", this._advanceCharacter.bind(this));

    // Handle gold
    html.on("change", "#gold", ev => {
      this._onGoldChange(ev);
    });

    // Archetype and origin config
    html.find(".character-archetype").click(this._onArchetypeConfig.bind(this));
    html.find(".character-origin").click(this._onOriginConfig.bind(this));

    // Battlescars handling
    html.on("click", "#current_hp", ev => {
      this.actor.update({"system.health.old": ev.target.value}); // Save the current health value
    });
    html.on("change", "#current_hp", ev => {
      this._onHealthChange(ev);
    });

    // Add and remove inventory slots
    html.on("click", "#add-slot", this._onAddInventorySlot.bind(this));
    html.on("click", "#remove-slot", this._onRemoveInventorySlot.bind(this));

    // Drag events for macros.
    if (this.actor.isOwner) {
      let handler = ev => this._onDragStart(ev);
      html.find("li.item").each((i, li) => {
        if (li.classList.contains("inventory-header")) return;
        li.setAttribute("draggable", true);
        li.addEventListener("dragstart", handler, false);
      });
    }

    // Toggle character's isDeprived status
    html.on("click", "#toggle-deprived", ev => this._onToggleDeprived(ev));
  }

  /**
   * Handle attribute save rolls.
   * @param {Event} event The originating click event.
   * @private
   */
  async _onAttributeSaveRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;

    if (dataset) {
      SABRolls.AttributeSaveRoll(dataset, this.actor);
    }
  }

  /**
   * Handle short rest rolls.
   * @param {Event} event The originating click event.
   * @private
   */
  async _onShortRestRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;

    if (dataset) {
      SABRolls.ShortRestRoll(dataset, this.actor);
    }
  }

  /**
   * Handle long rest rolls.
   * @param {Event} event The originating click event.
   * @returns {Promise<void>} A promise that resolves when the long rest action is completed.
   * @private
   */
  async _onLongRestRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;
    const chatTemplate = "systems/spellburn-and-battlescars/templates/chat/default-message.hbs";

    const body = this.actor.system.body;
    const mind = this.actor.system.mind;

    const bodyNeedsRest = body.value < body.max;
    const mindNeedsRest = mind.value < mind.max;

    if (bodyNeedsRest && mindNeedsRest) {
      new Dialog({
        title: game.i18n.localize("SAB.character.sheet.long-rest"),
        content: `<p>${game.i18n.localize("SAB.character.sheet.long-rest-description")}</p>`,
        buttons: {
          body: {
            label: game.i18n.localize("SAB.character.body.long"),
            callback: () => SABRolls.LongRestRoll(dataset, this.actor, "body")
          },
          mind: {
            label: game.i18n.localize("SAB.character.mind.long"),
            callback: () => SABRolls.LongRestRoll(dataset, this.actor, "mind")
          }
        },
        default: "body"
      }).render(true);
    } else if (bodyNeedsRest) {
      return SABRolls.LongRestRoll(dataset, this.actor, "body");
    } else if (mindNeedsRest) {
      return SABRolls.LongRestRoll(dataset, this.actor, "mind");
    }

    removeFatigueItems(this.actor);

    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: await renderTemplate(chatTemplate, {
        type: "long-rest",
        message: game.i18n.localize("SAB.chat.long-rest-no-attribute-recovery")
      })
    });
  }

  /**
   * Handle full rest action.
   * @param {Event} event The originating click event.
   * @private
   */
  async _onFullRest(event) {
    event.preventDefault();
    const chatTemplate = "systems/spellburn-and-battlescars/templates/chat/default-message.hbs";

    const updates = {
      "system.health.value": this.actor.system.health.max,
      "system.body.value": this.actor.system.body.max,
      "system.mind.value": this.actor.system.mind.max
    };

    removeFatigueItems(this.actor);

    await this.actor.update(updates);

    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: await renderTemplate(chatTemplate, {
        type: "full-rest",
        message: game.i18n.localize("SAB.chat.full-rest")
      })
    });
  }

  /**
   * Handle creating a new Owned Item for the actor using initial data defined in the HTML dataset
   * @param {Event} event   The originating click event
   * @private
   */
  async _onItemCreate(event) {
    event.preventDefault();
    const header = event.currentTarget;
    // Get the type of item to create.
    const type = header.dataset.type;
    // Grab any data associated with this control.
    const data = foundry.utils.duplicate(header.dataset);
    // Initialize a default name.
    let name = "";

    switch (type) {
      case "item":
        name = `${game.i18n.localize("SAB.actions.new-item")}`;
        break;
      case "feature":
        name = `${game.i18n.localize("SAB.actions.new-ability")}`;
        break;
      case "spell":
        name = `${game.i18n.localize("SAB.actions.new-spell")}`;
        break;
    }

    if (data.itemType === "fatigue") {
      name = game.i18n.localize("SAB.item.fatigue.name");
    }

    // Prepare the item object.
    const itemData = {
      name: name,
      type: type,
      system: data
    };

    // Remove the type from the dataset since it's in the itemData.type prop.
    delete itemData.system.type;

    // Finally, create the item!
    await Item.create(itemData, { parent: this.actor });
    this._checkInvSlots();
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   * @returns {Roll|void} The resulting roll, if any
   */
  async _onRoll(event) {
    event.preventDefault();
    const element = event.currentTarget;
    const dataset = element.dataset;

    // Handle item rolls.
    if (dataset.rollType) {
      if (dataset.rollType === "item") {
        const itemId = element.closest(".item").dataset.itemId;
        const item = this.actor.items.get(itemId);
        if (item) return item.roll();
      }
      if (dataset.rollType === "spell") {
        const spellId = element.closest(".item").dataset.itemId;
        const spell = this.actor.items.get(spellId);
        if (spell) return this._rollSpell(spell);
      }
    }

    // Handle rolls that supply the formula directly.
    if (dataset.roll) {
      let label = dataset.label ? `${dataset.label}`.toUpperCase() : "";
      let roll = new Roll(dataset.roll, this.actor.getRollData());

      await roll.evaluate();

      roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: label,
        rollMode: game.settings.get("core", "rollMode")
      });

      return roll;
    }
  }

  async _rollNewCharacter() {
    const rolls = [];
    for (let i = 0; i < 3; i++) {
      let roll = await new Roll("2d6+3").toMessage({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        flavor: game.i18n.localize("SAB.rollNewChar")
      });
      rolls.push(roll.rolls[0]);
    }
    rolls.sort((a, b) => a.total - b.total);
    const luck = rolls[0].total;
    const mind = rolls[1].total;
    const body = rolls[2].total;
    const hpRoll = await new Roll("1d6").toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: game.i18n.localize("SAB.HP.long")
    });
    this.actor.update({
      "system.attributes.luck.value": luck,
      "system.mind.value": mind,
      "system.mind.max": mind,
      "system.body.value": body,
      "system.body.max": body,
      "system.health.value": hpRoll.rolls[0].total,
      "system.health.max": hpRoll.rolls[0].total
    });
    ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: game.i18n.localize("SAB.charRollMsg")
    });
  }

  async _advanceCharacter() {
    new Dialog({
      title: game.i18n.localize("SAB.advance.dialog-title"),
      content: game.i18n.localize("SAB.advance.dialog-description"),
      buttons: {
        confirm: {
          icon: '<i class="fas fa-check"></i>',
          label: game.i18n.localize("SAB.actions.button-continue"),
          callback: async () => {
            const attributesToRoll = [];
            const thresholds = {
              body: this.actor.system.body.max,
              mind: this.actor.system.mind.max,
              luck: this.actor.system.attributes.luck.value
            };
            const results = [];

            if (thresholds.body < 18) attributesToRoll.push({ name: game.i18n.localize("SAB.character.body.long"), max: thresholds.body });
            if (thresholds.mind < 18) attributesToRoll.push({ name: game.i18n.localize("SAB.character.mind.long"), max: thresholds.mind });
            if (thresholds.luck < 18) attributesToRoll.push({ name: game.i18n.localize("SAB.character.luck.long"), max: thresholds.luck });

            for (const attribute of attributesToRoll) {
              const roll = await new Roll("d20");

              await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                flavor: `${game.i18n.localize("SAB.advance.attribute-chat-message")} ${attribute.name}`
              });

              results.push({
                name: attribute.name,
                value: roll.total,
                threshold: attribute.max,
                success: roll.total > attribute.max
              });
            }

            const summary = results.map(({ name, value, threshold, success }) => {
              const status = success ? `<strong>${game.i18n.localize("SAB.advance.roll-success")}</strong>` : "";
              return `<li>${name}: ${value} > ${threshold} ${status}</li>`;
            });

            const allFailed = results.every(({ success }) => !success);

            if (allFailed) {
              summary.push(`<li><strong>${game.i18n.localize("SAB.advance.no-advancement")}</strong></li>`);
            }

            const summaryMessage = `
              <h3>${game.i18n.localize("SAB.advance.attribute-chat-summary")}</h3>
              <ul class="chat-advance-summary">${summary.join("")}</ul>
              <div class="sab-chat success"><span>${game.i18n.localize("SAB.advance.increase-hp")}</span></div>
              <p class="chat-advance-tip">${game.i18n.localize("SAB.advance.tip")}</p>
            `;

            setTimeout(() => {
              ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor: this.actor }),
                content: summaryMessage
              });
            }, 3700); // 3.7 seconds
          }
        },
        cancel: {
          icon: '<i class="fas fa-times"></i>',
          label: game.i18n.localize("SAB.actions.button-cancel")
        }
      },
      default: "cancel"
    }).render(true);
  }

  // TODO: Fix gold change bug
  async _onGoldChange(ev) {
    let currentGold = parseInt(ev.target.value, 10);

    if (isNaN(currentGold)) {
      currentGold = 0;
    }

    await this.actor.update({ "system.attributes.gold.value": currentGold });
  }

  async _rollSpell(spell) {
    let maxBasePower = this._checkInvSlots();
    let powerLevel = await this._getPowerLevel(maxBasePower);
    if (powerLevel <= 0) {
      return ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: game.i18n.localize("SAB.item.spell.no-slots")
      });
    }
    let roll = await new Roll(`${powerLevel}d6`).toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: `[${spell.type}] ${spell.name}: ${spell.system.description}`,
      rollMode: game.settings.get("core", "rollMode")
    });
    let rollDice = roll.rolls[0].dice[0].results.map(result => result.result);
    let uniqueRolls = new Set(rollDice);
    if (uniqueRolls.size < rollDice.length) {
      let total=roll.rolls[0].total;
      if (total>21) {total=21;}
      ChatMessage.create({
        flavor: game.i18n.localize("SAB.Spellburn.flavor"),
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: game.i18n.localize(`SAB.Spellburn.${total}`)
      });
    }
    await this._checkFatigue(rollDice);
  }

  async _getPowerLevel(maxBasePower) {
    const items = this.actor.items.filter(item => item.type === "item");
    const totalWeight = items.reduce((sum, item) => sum + (item.system.weight || 0), 0);
    let availableSlots = this.actor.system.attributes.invSlots.value - totalWeight;
    availableSlots = Math.min(availableSlots, 5);

    let options = "";
    if (availableSlots === 0) {
      options = `<option value="0">${game.i18n.localize("SAB.item.spell.no-slots")}</option>`;
    } else {
      for (let i = 1; i <= availableSlots; i++) {
        options += `<option value="${i}">${i}</option>`;
      }
    }

    return new Promise(resolve => {
      new Dialog({
        title: game.i18n.localize("SAB.item.spell.pl-dialog"),
        content: `
          <form class="sheet-modal">
            <div>
              <label for="powerLevel">${game.i18n.localize("SAB.item.spell.power-level")}: </label>
              <select id="powerLevel" name="powerLevel" ${availableSlots === 0 && "disabled"} required>
                ${options}
              </select>
            </div>
          </form>
        `,
        buttons: {
          ok: {
            icon: '<i class="fas fa-check"></i>',
            label: game.i18n.localize("SAB.actions.cast-spell"),
            callback: html => {
              const form = html.find("form")[0];
              const power = parseInt(form.powerLevel.value);
              resolve(power);
            }
          }
        },
        default: "ok",
        render: html => {
          if (availableSlots === 0) {
            html.find('button[data-button="ok"]').prop("disabled", true);
          }
        }
      }).render(true);
    });
  }

  async _checkFatigue(rollDice) {
    let totalFatigue = 0;
    const fatigueData = {
      name: game.i18n.localize("SAB.item.fatigue.name"),
      type: "item",
      system: {
        weight: 1,
        itemType: "fatigue"
      }
    };

    rollDice.sort((a, b) => b - a);
    for (let i = 0; i < rollDice.length; i++) {
      if (rollDice[i] > 3) {
        await Item.create(fatigueData, { parent: this.actor });
        totalFatigue++;
      } else break;
    }

    if (totalFatigue > 0) {
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content:
          `${game.i18n.localize("SAB.item.fatigue.msg")} ${totalFatigue}`
      });
      this._checkInvSlots();
    }
  }

  async _onAddInventorySlot() {
    await this.actor.update({"system.attributes.invSlots.value": this.actor.system.attributes.invSlots.value + 1});
  }

  async _onRemoveInventorySlot() {
    await this.actor.update({"system.attributes.invSlots.value": this.actor.system.attributes.invSlots.value - 1});
  }

  _onHealthChange(ev) {
    // TODO: Fix health change scars logic
  }

  _checkInvSlots() {
    let currentSlots = this.actor.system.attributes.invSlots.value;
    let items = this.actor.items.filter(item => item.type === "item");
    let totalWeight = items.reduce((sum, item) => sum + (item.system.weight || 0), 0);

    if (totalWeight >= currentSlots) {
      ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: this.actor }),
        content: game.i18n.localize("SAB.encumbrance.overburdened")
      });
    }

    return currentSlots-totalWeight;
  }

  _onArchetypeConfig(event) {
    event.preventDefault();
    const archetype = this.actor.system.attributes.archetype;

    new Dialog({
      title: game.i18n.localize("SAB.character.archetype"),
      content: `
        <form class="sheet-modal">
          <div>
            <label>${game.i18n.localize("SAB.character.sheet.archetype.label")}</label>
            <input type="text" name="name" value="${archetype.name}" placeholder="${game.i18n.localize("SAB.character.sheet.archetype.placeholder")}">
          </div>
          <div>
            <label>${game.i18n.localize("SAB.character.sheet.trigger.label")}</label>
            <input type="text" name="trigger" value="${archetype.trigger}" placeholder="${game.i18n.localize("SAB.character.sheet.trigger.placeholder")}">
          </div>
        </form>
      `,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: game.i18n.localize("SAB.actions.save"),
          callback: html => {
            const form = html.find("form")[0];
            this.actor.update({
              "system.attributes.archetype.name": form.name.value,
              "system.attributes.archetype.trigger": form.trigger.value
            });
          }
        }
      },
      default: "save"
    }).render(true);
  }

  _onOriginConfig(event) {
    event.preventDefault();
    const origin = this.actor.system.attributes.origin;

    new Dialog({
      title: game.i18n.localize("SAB.character.origin"),
      content: `
        <form class="sheet-modal">
          <div>
            <label>${game.i18n.localize("SAB.character.sheet.origin.label")}</label>
            <input type="text" name="question" value="${origin.question}" placeholder="${game.i18n.localize("SAB.character.sheet.origin.question-placeholder")}">
          </div>
          <div>
            <label>${game.i18n.localize("SAB.character.sheet.origin.answer-title")}</label>
            <input type="text" name="answerTitle" value="${origin.answer.title}" placeholder="${game.i18n.localize("SAB.character.sheet.origin.answer-title-placeholder")}">
          </div>
          <div>
            <label>${game.i18n.localize("SAB.character.sheet.origin.answer-description")}</label>
            <textarea name="answerDescription" placeholder="${game.i18n.localize("SAB.character.sheet.origin.answer-description-placeholder")}">${origin.answer.description}</textarea>
          </div>
        </form>
      `,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: game.i18n.localize("SAB.actions.save"),
          callback: html => {
            const form = html.find("form")[0];
            this.actor.update({
              "system.attributes.origin.question": form.question.value,
              "system.attributes.origin.answer.title": form.answerTitle.value,
              "system.attributes.origin.answer.description": form.answerDescription.value
            });
          }
        }
      },
      default: "save"
    }).render(true);
  }

  _onArmorConfig(event) {
    event.preventDefault();
    const armorValue = this.actor.system.ar.value;

    new Dialog({
      title: game.i18n.localize("SAB.character.armor.long"),
      content: `
        <form class="sheet-modal">
          <div>
            <label>${game.i18n.localize("SAB.character.sheet.armor.label")}</label>
            <input type="number" name="armor" value="${armorValue}" min="-3" max="3">
            <p class="modal-text__description">${game.i18n.localize("SAB.character.sheet.armor.text")}</p>
          </div>
        </form>
      `,
      buttons: {
        save: {
          icon: '<i class="fas fa-save"></i>',
          label: game.i18n.localize("SAB.actions.save"),
          callback: html => {
            const form = html.find("form")[0];
            let newValue = form.armor.value.trim() === "" ? 0 : parseInt(form.armor.value, 10);

            if (newValue < -3) newValue = -3;
            if (newValue > 3) newValue = 3;

            this.actor.update({
              "system.ar.value": newValue
            });
          }
        }
      },
      default: "save"
    }).render(true);
  }

  _onItemQuantityAdd(event) {
    const li = $(event.currentTarget).parents(".item");
    const item = this.actor.items.get(li.data("itemId"));

    const newQuantity = (item.system.quantity || 0) + 1;

    item.update({ "system.quantity": newQuantity });
  }


  _onItemQuantityRemove(event) {
    const li = $(event.currentTarget).parents(".item");
    const item = this.actor.items.get(li.data("itemId"));

    const newQuantity = item.system.quantity > 0 ? item.system.quantity - 1 : 0;

    item.update({ "system.quantity": newQuantity });
  }

  /**
   * Toggles the deprived status of the character.
   * @param {Event} event The triggering click event.
   * @returns {Promise} A promise that resolves when the actor update is complete.
   * @private
   */
  _onToggleDeprived(event) {
    event.preventDefault();

    const isCurrentlyDeprived = this.actor.system.attributes.isDeprived;
    return this.actor.update({ "system.attributes.isDeprived": !isCurrentlyDeprived });
  }
}

