import { Component, OnDestroy, OnInit } from "@angular/core";
import { firstValueFrom, map, Subject, switchMap, takeUntil } from "rxjs";

import { InputPasswordFlow, PasswordInputResult } from "@bitwarden/auth/angular";
import { PolicyService } from "@bitwarden/common/admin-console/abstractions/policy/policy.service.abstraction";
import { MasterPasswordPolicyOptions } from "@bitwarden/common/admin-console/models/domain/master-password-policy-options";
import { AccountService } from "@bitwarden/common/auth/abstractions/account.service";
import { MasterPasswordApiService } from "@bitwarden/common/auth/abstractions/master-password-api.service.abstraction";
import { UserVerificationService } from "@bitwarden/common/auth/abstractions/user-verification/user-verification.service.abstraction";
import { VerificationType } from "@bitwarden/common/auth/enums/verification-type";
import { ForceSetPasswordReason } from "@bitwarden/common/auth/models/domain/force-set-password-reason";
import { PasswordRequest } from "@bitwarden/common/auth/models/request/password.request";
import { getUserId } from "@bitwarden/common/auth/services/account.service";
import { MasterPasswordVerification } from "@bitwarden/common/auth/types/verification";
import { InternalMasterPasswordServiceAbstraction } from "@bitwarden/common/key-management/master-password/abstractions/master-password.service.abstraction";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { MessagingService } from "@bitwarden/common/platform/abstractions/messaging.service";
import { UserId } from "@bitwarden/common/types/guid";
import { UserKey } from "@bitwarden/common/types/key";
import { DialogService } from "@bitwarden/components";
import { KeyService } from "@bitwarden/key-management";

@Component({
  selector: "app-update-temp-password",
  templateUrl: "update-temp-password.component.html",
})
export class UpdateTempPasswordComponent implements OnInit, OnDestroy {
  enforcedPolicyOptions: MasterPasswordPolicyOptions | undefined;
  reason: ForceSetPasswordReason = ForceSetPasswordReason.None;
  verification: MasterPasswordVerification = {
    type: VerificationType.MasterPassword,
    secret: "",
  };

  protected readonly InputPasswordFlow = InputPasswordFlow;
  protected email: string | undefined = "";
  protected userId: UserId | undefined;

  protected destroy$ = new Subject<void>();

  constructor(
    protected i18nService: I18nService,
    protected messagingService: MessagingService,
    protected dialogService: DialogService,
    protected accountService: AccountService,
    protected policyService: PolicyService,
    protected masterPasswordApiService: MasterPasswordApiService,
    protected masterPasswordService: InternalMasterPasswordServiceAbstraction,
    protected userVerificationService: UserVerificationService,
    protected keyService: KeyService,
    protected logService: LogService,
  ) {}

  async ngOnInit() {
    this.email = await firstValueFrom(
      this.accountService.activeAccount$.pipe(map((a) => a?.email)),
    );
    this.userId = await firstValueFrom(this.accountService.activeAccount$.pipe(map((a) => a?.id)));

    if (!this.userId) {
      this.logService.error(
        "No user id found while initing in the update temp password component.",
      );
      return;
    }

    this.reason = await firstValueFrom(
      this.masterPasswordService.forceSetPasswordReason$(this.userId),
    );
    this.accountService.activeAccount$
      .pipe(
        getUserId,
        switchMap((userId) => this.policyService.masterPasswordPolicyOptions$(userId)),
        takeUntil(this.destroy$),
      )
      .subscribe((enforcedPasswordPolicyOptions) => {
        return (this.enforcedPolicyOptions ??= enforcedPasswordPolicyOptions);
      });
  }

  protected async handlePasswordFormSubmit(passwordInputResult: PasswordInputResult) {
    if (!this.userId) {
      this.logService.error("No user id found while trying to handle password form submission.");
      return;
    }

    const userKey = await firstValueFrom(this.keyService.userKey$(this.userId));

    if (!userKey) {
      this.logService.error("No user key found while trying to handle password form submission.");
      return;
    }

    switch (this.reason) {
      case ForceSetPasswordReason.AdminForcePasswordReset:
        // await this.updateTempPassword(passwordInputResult. masterPasswordHash, userKey);
        break;
      case ForceSetPasswordReason.WeakMasterPassword:
        await this.updatePassword(passwordInputResult, userKey);
        break;
      case ForceSetPasswordReason.TdeOffboarding:
        // await this.updateTdeOffboardingPassword(masterPasswordHash, userKey);
        break;
    }
  }

  // private async updateTempPassword(masterPasswordHash: string, userKey: [UserKey, EncString]) {
  //   const request = new UpdateTempPasswordRequest();
  //   request.key = userKey[1].encryptedString;
  //   request.newMasterPasswordHash = masterPasswordHash;
  //   request.masterPasswordHint = this.hint;
  //
  //   return this.masterPasswordApiService.putUpdateTempPassword(request);
  // }

  private async updatePassword(
    passwordInputResult: PasswordInputResult,
    userKey: UserKey,
  ): Promise<void> {
    if (!passwordInputResult.currentPassword) {
      this.logService.error(
        "No current password found while trying to handle password form submission.",
      );
      return;
    }

    this.verification.secret = passwordInputResult.currentPassword;

    const request = await this.userVerificationService.buildRequest(
      this.verification,
      PasswordRequest,
    );

    request.masterPasswordHint = passwordInputResult.newPasswordHint;
    request.newMasterPasswordHash = passwordInputResult.newLocalMasterKeyHash;
    request.key = userKey.keyB64;

    this.logService.info(request);

    // return this.masterPasswordApiService.postPassword(request);
  }

  async logOut(): Promise<void> {
    const confirmed = await this.dialogService.openSimpleDialog({
      title: { key: "logOut" },
      content: { key: "logOutConfirmation" },
      acceptButtonText: { key: "logOut" },
      type: "warning",
    });

    if (confirmed) {
      this.messagingService.send("logout");
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
