# Set booster references

One Markdown file per Magic set that can be drafted from its boosters instead of from a CubeCobra cube. Each file
records what goes into that set's draft booster: the card pools, every slot and its odds, and the special rules
that real packs follow. It is the spec the pack generator is built from and checked against. Research a set here
before writing any code for it.

The files describe packs as this app drafts them, not everything in a real booster: foil and non-foil count as the
same card, and anything that isn't a Magic card (tokens, art cards, counter cards) is left out.

## Naming

`<set code>-<set name>.md`, lowercase, with the set code Scryfall uses: `fra-reality-fracture.md`.

## Sections

Every file uses these sections, in this order. Leave out a section only when the set has nothing for it.

1. **Summary**: set code(s), release date, which booster is drafted and how many cards it holds.
2. **Set mechanics that affect packs**: anything that makes this set's packs differ from a plain rarity split.
3. **Card pools**: every group of printings a slot draws from, by collector number, with counts per rarity.
4. **Pack layout**: one row per slot: how many cards, which pools, the official odds, and the weights that
   reproduce them.
5. **Rules the generator must keep**: invariants a generated pack must satisfy, written so a test can check them.
6. **Lists**: tables the rules need, such as which cards belong together.
7. **Notes for this simulator**: what the pack layout means for this codebase. Keep it short; the generator's
   design belongs in its own change.
8. **Conflicts and decisions**: every point where sources disagree or say nothing, and what the app does about
   it. Ask the maintainer to decide each one; record the answer and the date.
9. **Sources**: links, with the date they were read.

## Confidence

Mark every figure that isn't plainly official:

- *official*: printed by Wizards of the Coast (a "Collecting …" article, the product page).
- *derived*: computed from official figures, or taken from a source that reproduces them (such as mtg.wtf's
  booster data); give the calculation or the source.
- *assumption*: not confirmed anywhere; say what it rests on, so it can be checked when better data appears.

Odds are per pack unless a row says otherwise. Weights are relative: a weight is only meaningful next to the
other weights of the same slot.
