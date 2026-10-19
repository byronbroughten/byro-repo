// Raised once a ticket's Halts are posted: SpecRun.ts leaves the ticket unlanded and moves on to tickets outside their scope.
export class TicketHalted extends Error {
  constructor(ticketLabel: string) {
    super(`${ticketLabel} halted`);
    this.name = "TicketHalted";
  }
}
