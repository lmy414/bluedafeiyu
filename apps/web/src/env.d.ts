declare namespace App {
  interface Locals {
    activeEvent?: ReturnType<typeof import('./lib/active-event').loadActiveEvent>;
  }
}
