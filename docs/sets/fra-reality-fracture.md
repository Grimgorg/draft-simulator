# Reality Fracture (FRA)

Researched 2026-10-25. Confidence marks follow [README.md](README.md#confidence).

Only what this app drafts is covered: the 14 Magic cards of a Play Booster. Foil versus non-foil is ignored (a foil
card is drafted like any other), and so are the cards in a pack that aren't Magic cards (the token or counter card).

## Summary

| | |
|---|---|
| Set code | `FRA` (Scryfall `fra`); Special Guests are `SPG` |
| Released | 2026-10-02 |
| Drafted booster | Play Booster |
| Cards per pack | 14 |
| Draft | 3 Play Boosters per player, the usual pick-one draft |

Collector Boosters are not drafted and are out of scope. The Draft Night box (12 Play Boosters, 1 Collector
Booster) is a retail bundle, not a different booster.

## Set mechanics that affect packs

**Echoed pairs.** 43 pairs of cards, 86 cards in all (collector numbers 195–280). Each pair is one character from
the Multiverse and that character's counterpart in the Echoverse ("an icy Chandra, a vengeful Ajani"). Both cards
of a pair have the same rarity: 33 uncommon pairs, 7 rare pairs, 3 mythic pairs. Most pairs are legendary
creatures; five are pairs of "Way of the …" enchantments. *official*

Every Play Booster has three echoed pair cards: one complete pair and one card from another pair. See the echoed
pairs slot below. *official* (Wizards: "Includes 2 cards of the same rarity from the same set of echoed pairs cards";
the third card is described by Draftsim, the WPN event page and mtg.wtf)

In a normal draft the pairs are ordinary cards: the set was "designed primarily for pick-one drafts", and the
halves of a pair were designed not to go into the same deck. *official*

**Reality Echoes (optional variant, out of scope).** A Wizards in-store event (2026-10-16 to 2026-11-05) that
drafts the same Play Boosters as a *Pick-Two Draft*. Before each game a player may reveal one complete echoed pair
they drafted; both cards start the game in exile, the player may cast either one as though it were in their hand,
and on casting it may shuffle the other into their library. Only one pair per game, and two copies of the same card
aren't a pair. Packs are unchanged, so the generator needs nothing extra for it. *official*

## Card pools

All in set `FRA` unless noted. Numbers are Scryfall collector numbers, checked against Scryfall (461 printings).

| Pool | Numbers | Commons | Uncommons | Rares | Mythics | Notes |
|---|---|---|---|---|---|---|
| Main set | 1–194 | 71 | 43 | 50 | 20 | The 10 common dual lands below are also in this range but are excluded here |
| Common dual lands | 175, 177, 178, 182, 183, 184, 190, 192, 193, 194 | 10 | | | | Land slot only |
| Echoed pairs | 195–280 | | 66 | 14 | 6 | 43 pairs, [listed below](#echoed-pairs-list) |
| Default basic lands | 281–290 | 10 | | | | 2 artworks per basic type |
| Borderless echoed pairs | 291–320 | | 10 | 14 | 6 | Every rare and mythic pair, plus the uncommon Teyo, Thalia, Fblthp, Winter and Marwyn pairs |
| Shattered mirror | 321–333 | | | 5 | 8 | |
| Sculptor's stronghold | 334–358 | | | 18 | 7 | Showcase frame |
| Braintwister series | 359–381 | | 5 | 15 | 3 | Borderless |
| Tower basic lands | 382–396 | 15 | | | | 3 artworks per basic type |
| Portal view lands | 397–401 | | | 5 | | Borderless versions of the rare lands 176, 180, 185, 186, 189 |
| Special Guests (`SPG`) | SPG 159–168 | | | | 10 | Eye of Ugin, Austere Command, Flesh Duplicate, Consign to Memory, Sublime Epiphany, Consider, Necrodominance, Mind Twist, Splinter Twin, Root Maze |
| Not in Play Boosters | 402–461 | | | | | Headliner, Japan Showcase, extended art, promo pack, bundle and Collector Booster printings |

Rarity totals as Wizards counts them, with echoed pairs: 71 commons, 109 uncommons, 64 rares, 26 mythics.
*official*, and they match the table.

**Booster-fun versions** are alternate printings of a main-set or echoed card: same name, same rules, a different
frame. Each one replaces its regular printing in a slot (the regular card's weight is split, see the weights
below), so they never add new cards to the draft, only new looks.

Scryfall's `booster` field is `false` on every FRA printing, so don't use it to tell booster cards from the rest;
use the collector numbers above.

## Pack layout

14 cards, in this order. Odds are per pack. "Wizards" is the official figure; "weights" are mtg.wtf's
per-card weights, which reproduce it (*derived*).

| # | Slot | Cards | Draws from | Wizards | Weights |
|---|---|---|---|---|---|
| 1 | Commons | 6 | Main-set commons (71) | In 1 of 55 packs, 1 of the 6 is replaced by a Special Guest | Special Guest: 1 in 55 = 1.82% |
| 2 | Uncommon | 1 | Main-set uncommons (43), no echoed cards | Braintwister version 3.8% | Per card: braintwister 1, its regular printing 2, other uncommons 3, giving 3.88% |
| 3 | Common or uncommon | 1 | Slot 1's or slot 2's pool | Common 23%, uncommon 74%, braintwister uncommon 3% | Common 23 : uncommon 77, then slot 2's weights, giving 2.98% braintwister |
| 4 | Echoed pairs | 3 | Echoed pairs (and their borderless versions) | Uncommon 88.9%, rare 6.7%, mythic 1.4%; borderless uncommon 1.7%, rare and mythic < 1% each | See [below](#slot-4-echoed-pairs) |
| 5 | Rare or mythic | 1 | Main-set rares (50) and mythics (20), no echoed cards | Rare 74.4%, mythic 14.8%, plus the versions in the next table | Per card: rare 2, mythic 1, giving rare 83.33% and mythic 16.67% in all |
| 6 | Any rarity | 1 | All of slots 1, 2 and 5's pools plus the echoed pairs (the pack's foil card) | Common 49.5%, uncommon 40.5%, rare 6%, mythic 1.2%; each booster-fun version < 1% | Per card: common 40, uncommon 22, rare 6, mythic 3, giving 49.82%, 42.07%, 6.74%, 1.37% |
| 7 | Land | 1 | Default basics, tower basics, common duals | See [below](#slot-7-land) | See below |

Slot counts: 6 + 1 + 1 + 3 + 1 + 1 + 1 = 14.

### Booster-fun versions in slots 2, 3, 5 and 6

A card that has a booster-fun version splits its weight between the two printings: in slots 5 and 6 the version
gets 1 part in 8 and the regular printing 7; in slots 2 and 3 the version gets 1 part in 3 and the regular printing
2 (the weights 1 and 2 above, next to 3 for an uncommon without one). *derived*

Slot 5, rare or mythic:

| Version | Rare: Wizards | Rare: weights | Mythic: Wizards | Mythic: weights |
|---|---|---|---|---|
| Regular printing | 74.4% | 74.38% | 14.8% | 14.79% |
| Shattered mirror | 1% | 1.04% | < 1% | 0.83% |
| Sculptor's stronghold | 3.8% | 3.75% | 1% | 0.73% |
| Braintwister series | 3.1% | 3.13% | < 1% | 0.31% |
| Portal view land | 1% | 1.04% | | |

Slot 6, any rarity: borderless echoed pairs, braintwister, sculptor's stronghold and portal view lands can
appear, each under 1% (*official*), with the same 1-in-8 split. Shattered mirror versions never appear in this slot,
so their regular printing keeps the full weight here. *derived*

### Slot 4: echoed pairs

1. **Pick one pair** with per-pair weight uncommon 5, rare 2, mythic 1: uncommon 90.66%, rare 7.69%, mythic
   1.65%. This matches Wizards once their borderless figures are added (88.9 + 1.7, 6.7 + < 1, 1.4 + < 1). *derived*
2. **Borderless?** If the pair has a borderless version, it is borderless 1 time in 8, and then **both** halves are
   borderless: borderless uncommon pair 1.72% of packs (Wizards: 1.7%), rare 0.96%, mythic 0.21%. That both halves
   switch together is an *assumption* this app adopts: mtg.wtf based it on a box-opening video, and Wizards
   doesn't say.
3. **Add a third echoed card** from any **other** pair, with per-card weight uncommon 5, rare 2, mythic 1
   (90.66% / 7.69% / 1.65% before removing the chosen pair). It can be borderless the same 1 time in 8. Its rarity
   doesn't depend on the pair's. *derived* from mtg.wtf; Wizards gives no separate odds for it, and this app
   follows mtg.wtf.

### Slot 7: land

Every card in a group has the same weight: default basics 1, tower basics 1, common duals 3. With 10, 15 and 10
cards, the groups' shares are 10 : 15 : 30. *derived*, and it matches Wizards exactly once their foil and non-foil
figures are added together. *official*

| Land | Share | Wizards |
|---|---|---|
| Default basic (281–290) | 18.18% | 18.2% (14.6 + 3.6) |
| Tower basic (382–396) | 27.27% | 27.3% (21.8 + 5.5) |
| Common dual (10 numbers above) | 54.55% | 54.5% (43.6 + 10.9) |

## Rules the generator must keep

1. A pack has exactly 14 cards.
2. Echoed pair cards (195–280, 291–320) appear only in slots 4 and 6, never in slots 1, 2, 3 or 5.
3. Slot 4 always holds both halves of exactly one pair plus one card from a different pair, at that card's own
   rarity.
4. The common dual lands appear only in the land slot: never in slots 1 or 3, nor as slot 6's common.
   *derived*: Wizards' common count (71) leaves them out, and so does mtg.wtf.
5. Every pack has at least one rare or mythic (slot 5).
6. A Special Guest replaces a common, so that pack has 5 commons in slot 1, not 6.
7. Booster-fun versions only replace their regular printing; they never add cards that aren't in the set. The
   pack shows the version that was drawn.
8. No card appears twice in a pack, counting a booster-fun version as its regular card. A slot that draws a card
   already in the pack draws again. (Real packs come from print sheets, which makes repeats very rare; Wizards
   doesn't say.)
9. There's no cap on rares and mythics: slot 5 always adds one, and slots 1 (Special Guest), 4 and 6 add more only
   by their own odds.

## Echoed pairs list

Both halves share the pair's rarity. Borderless numbers are blank for pairs without a borderless version.
Wizards doesn't list which half is the Multiverse card and which the Echoverse card, and the generator doesn't need
to know, so the columns are just in collector-number order.

| Rarity | Card | # | Its pair | # | Borderless # |
|---|---|---|---|---|---|
| Mythic | Ajani Resolute | 195 | Ajani Unrelenting | 242 | 291, 308 |
| Mythic | Chandra, Chill of Compliance | 212 | Chandra, Torch of Defiance | 244 | 297, 309 |
| Mythic | Garruk, Veiled Butcher | 229 | Garruk, Curse Breaker | 259 | 303, 314 |
| Rare | Gideon's Memorial | 198 | Gideon the Oathless | 230 | 292, 304 |
| Rare | Liliana the Faultless | 200 | Liliana the Repentant | 231 | 293, 305 |
| Rare | Lyra, Archangel of Dawn | 201 | Lyra, Tolarian Archangel | 217 | 294, 301 |
| Rare | Jace, Reality Sculptor | 216 | Tam, the Possibility | 276 | 300, 317 |
| Rare | Samut, Tyrant of Naktamun | 220 | Samut, Hazoret's Champion | 251 | 302, 311 |
| Rare | Karn, Gilded Guardian | 272 | Karn, Argent Defender | 279 | 316, 320 |
| Rare | Vraska, Soul of Stone | 277 | Vraska, the Cutting Glare | 278 | 318, 319 |
| Uncommon | Danitha, Sword of Hope | 196 | Danitha, Spear of Agony | 227 | |
| Uncommon | Ghalta the Immovable | 197 | Ghalta the Unstoppable | 260 | |
| Uncommon | Koth of the Homestead | 199 | Koth, the Geomancer | 248 | |
| Uncommon | Rescue Girl, First Responder | 202 | Massacre Girl, Most Wanted | 234 | |
| Uncommon | Saheeli, Consul of Oversight | 203 | Saheeli, Jewel of Avishkar | 275 | |
| Uncommon | Teyo, Lightshield Expert | 204 | Teyo, Diamondblade Mage | 236 | 295, 306 |
| Uncommon | Thalia, the Survivor | 205 | Geist of Saint Thalia | 214 | 296, 299 |
| Uncommon | Tomik, Orzhov Lawmage | 206 | Tomik, Izzet Sparkmage | 253 | |
| Uncommon | Way of the Healer | 207 | Way of the Necromancer | 239 | |
| Uncommon | Way of the Mentor | 208 | Way of the Warlord | 255 | |
| Uncommon | Yoshimaru, Beloved Companion | 209 | Yoshimaru, Scrappy Stray | 269 | |
| Uncommon | Yuriko, Blade of the Mighty | 210 | Yuriko, Hope from the Shadows | 226 | |
| Uncommon | Arni, Humble Scribe | 211 | Arni, Renowned Champion | 243 | |
| Uncommon | Fblthp, Impossibly Lost | 213 | Fblthp, Knows the Way | 258 | 298, 313 |
| Uncommon | Hapatra, the Desert Frost | 215 | Hapatra, the Desert Fang | 271 | |
| Uncommon | Proft, Consulting Detective | 218 | Proft, Sinister Mastermind | 235 | |
| Uncommon | Ruric Thar, Biomagus | 219 | Ruric Thar, Magecrusher | 265 | |
| Uncommon | Tetsuko Umezawa, Fugitive | 221 | Tetsuko Umezawa, Pursuer | 252 | |
| Uncommon | Traxos, Academy Guardian | 222 | Traxos, Scourge Eternal | 280 | |
| Uncommon | Way of the Cryomancer | 223 | Way of the Pyromancer | 254 | |
| Uncommon | Way of the Mind Sculptor | 224 | Way of the Paradox | 267 | |
| Uncommon | Yargle, Goliath of Otaria | 225 | Yargle, Glutton of Urborg | 241 | |
| Uncommon | Gallia, Tragic Host | 228 | Gallia, the Merrymaker | 245 | |
| Uncommon | Loot, the Anomaly | 232 | Loot, the Nexus | 262 | |
| Uncommon | Mabel, Bitter Recluse | 233 | Mabel, Valley Hero | 274 | |
| Uncommon | Tinybones, Pocket Nuisance | 237 | Titanbones, Towering Heart | 266 | |
| Uncommon | Way of the Deathbringer | 238 | Way of the Wildspeaker | 268 | |
| Uncommon | Winter, Tormented Loner | 240 | Winter, Team Player | 256 | 307, 312 |
| Uncommon | Jiang Yanggu, Alone | 246 | Jiang Yanggu, Never Alone | 261 | |
| Uncommon | Kiora of Fire and Ashes | 247 | Kiora of Salt and Sand | 273 | |
| Uncommon | Marwyn, the Clearcutter | 249 | Marwyn, the Preserver | 263 | 310, 315 |
| Uncommon | Pia, Determined Rebuilder | 250 | Pia, Aether Ascetic | 264 | |
| Uncommon | Edgar, Moonlit Sovereign | 257 | Edgar, Ancient Bloodlord | 270 | |

The pairs are from mtg.wtf's booster data; their numbers and names were checked against Scryfall.

## Notes for this simulator

- The card cache holds one printing per card (`selectFirstPrintings` in `server/src/cardData/importBulkData.ts`)
  and stores no set, collector number or rarity. Generating FRA packs needs those for every FRA and SPG printing.
- Packs show the booster-fun version that was drawn, so the card data needs those printings too (numbers 281–401
  and SPG 159–168), not just the regular ones.
- Rule 3 is the one a cube-style "random cards by rarity" generator gets wrong: slot 4 must be built from the pair
  list, not drawn card by card.

## Conflicts and decisions

Each point where sources disagree or say nothing, and what this app does about it. Decided 2026-10-25.

| Point | Decision |
|---|---|
| Some retailer listings give "7 commons, 3 uncommons, 1 wildcard, 1 rare or mythic, 1 foil, 1 land", the generic Play Booster layout of earlier sets. | Use Wizards' layout ([Pack layout](#pack-layout)). |
| Wizards says "5–6 commons". | 5 only when a Special Guest replaces one, in 1 of 55 packs. Special Guests are included. |
| Slot 6 odds: Wizards gives 49.5 / 40.5 / 6 / 1.2% and lists the booster-fun versions (about 2.8%) separately; mtg.wtf's weights give 49.82 / 42.07 / 6.74 / 1.37% with those versions counted in each rarity. | Use mtg.wtf's weights. |
| One source says every pack has an echoed pair "of legendary cards", but the five "Way of the …" pairs are enchantments. | All 43 pairs can be a pack's pair. |
| One retailer says "1–5 cards of rarity rare or higher" per pack. | No cap: the count follows from the slot odds. Almost every pack has exactly one; slots 4 and 6 and a Special Guest can add more, up to 6. |
| Booster-fun versions play like the regular card, so the app could skip them. | Show the actual version, drawn at its odds. |
| Whether a borderless pair has both cards borderless: Wizards doesn't say, mtg.wtf assumes so from a box-opening video. | Both halves are borderless together. Still an *assumption*. |
| Whether a pack can hold the same card twice: Wizards doesn't say. | Never: see rule 8. |
| The third echoed card's rarity: Wizards gives no odds for it. | Its rarity is drawn on its own, as mtg.wtf does ([slot 4](#slot-4-echoed-pairs)). |

## Sources

Read 2026-10-25.

- Wizards of the Coast, [Collecting Reality Fracture](https://magic.wizards.com/en/news/feature/collecting-reality-fracture): slots, odds, set sizes.
- Wizards of the Coast, [Enter the Echoverse with Reality Fracture Design](https://magic.wizards.com/en/news/feature/enter-the-echoverse-with-reality-fracture-design): what echoed pairs are, three legends per pack.
- Wizards Play Network, [Magic Presents: Reality Echoes](https://wpn.wizards.com/en/event/magic-presents-reality-echoes): the pick-two event, "two cards that form a true pair, plus one unpaired".
- mtg.wtf / taw, [`fra-play.yaml`](https://github.com/taw/magic-search-engine/pull/636) in magic-search-engine (merged 2026-09-28; later moved to `data/boosters/fra/`): per-card weights, the pair list.
- Scryfall, [FRA](https://scryfall.com/sets/fra) and [SPG](https://scryfall.com/sets/spg): collector numbers, rarities, names.
- Draftsim, [The Ultimate Sealed Guide to Reality Fracture](https://draftsim.com/mtg-reality-fracture-sealed-guide/): "two out of three of those cards will be a true pairing".
