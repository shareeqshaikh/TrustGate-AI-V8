import { ENV, logStartupConfig } from "./config/env.js";
import { app } from "./app.js";
import { seedAdminAccount, migrateUserRoles } from "./utils/roles.js";
import { ReminderSchedulerService } from "./services/reminder-scheduler.service.js";

async function bootstrap() {
  await seedAdminAccount();
  await migrateUserRoles();
  app.listen(ENV.PORT, () => {
    logStartupConfig();
    ReminderSchedulerService.startScheduler();
  });
}

bootstrap();

