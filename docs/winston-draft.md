# Winston Draft

A draft format for exactly two players. It is the spec for `server/src/draftEngine/winstonDraft.ts`: change both
together.

## Rules

1. **Pool.** Each player opens their packs without looking. All the cards are shuffled together into one
   face-down **stack**. The classic size is three boosters each: 90 cards with 15-card packs, 84 with 14-card Play
   Boosters.
2. **Setup.** The top three cards of the stack start three face-down **piles** of one card each.
3. **A turn.** The player whose turn it is looks at pile 1 and either:
   - **takes it:** every card in the pile goes into their pool, the pile starts again with the top card of the
     stack, and their turn ends; or
   - **passes it:** the top card of the stack goes face down onto that pile, and they look at the next pile the
     same way.

   Passing pile 3 gets them the top card of the stack instead, unseen, and their turn ends.
4. Players take turns. The first player in the lobby goes first.
5. **End.** The draft ends when the stack and all three piles are empty. Players can end up with different numbers
   of cards: that's part of the format.

## Hidden information

- The stack and the piles are face down. A player sees only the pile they are looking at, and only on their turn.
  They may remember piles they looked at before.
- Both players see whose turn it is, which pile is being looked at, how many cards each pile holds and how many
  are left in the stack.
- The card drawn after passing pile 3 goes straight into that player's pool.

## Conflicts and decisions

- **Pool size.** The mtg.wiki rules say three boosters per player; Card Kingdom says six boosters in all. They
  agree. The app uses the draft's packs per player (default 3) and its pack size, so a cube or set Winston draft
  opens the same packs a normal draft would, then shuffles them into the stack.
- **When the stack runs out.** No source covers it. The app follows phase-rs's ruling, with Crazier Eights' last
  card rule:
  - A pass adds a card to the pile only while the stack has one, and a taken pile starts again only while the
    stack has one. Empty piles are skipped.
  - A player can pass only if their turn still gets them a card: a later pile has cards, or the stack has a card
    left to draw. So with an empty stack, the last pile left must be taken, and the draft always ends.
  - If only one card is left in the stack when a player passes their last pile, they draw it, and the pile stays
    as it is.
- **More than two players.** Some groups play Winston with three or four. The app supports two only.

## Sources

Read 2026-10-29.

- [mtg.wiki: Winston Draft](https://mtg.wiki/page/Winston_Draft)
- [Card Kingdom: Winston Draft 101](https://blog.cardkingdom.com/winston-draft-101/)
- [Endstep: Winston draft](https://endstep.cc/formats/winston-draft)
- [Crazier Eights: Winston Draft](https://craziereights.com/2021/10/08/winston-draft/)
- [phase-rs pull request #8870: Add Winston Draft](https://github.com/phase-rs/phase/pull/8870)
