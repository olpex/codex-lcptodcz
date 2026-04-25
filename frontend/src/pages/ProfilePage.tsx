import { FormEvent, useState } from "react";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { FormField, FormSubmitButton, formControlClass } from "../components/FormField";
import { Panel } from "../components/Panel";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

type MessageResponse = {
  message: string;
};

type ProfileFormErrors = {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
};

export function ProfilePage() {
  const { request, logout, user } = useAuth();
  const { showError, showInfo, showSuccess } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ProfileFormErrors>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const validate = () => {
    const nextErrors: ProfileFormErrors = {};
    if (!currentPassword) {
      nextErrors.currentPassword = "Вкажіть поточний пароль";
    }
    if (newPassword.length < 8) {
      nextErrors.newPassword = "Новий пароль має містити щонайменше 8 символів";
    } else if (newPassword.length > 72) {
      nextErrors.newPassword = "Новий пароль має містити не більше 72 символів";
    }
    if (newPassword !== confirmPassword) {
      nextErrors.confirmPassword = "Підтвердження пароля не співпадає";
    }
    setFieldErrors(nextErrors);
    return nextErrors;
  };

  const submitChange = async () => {
    setSubmitting(true);
    try {
      const response = await request<MessageResponse>("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword
        })
      });
      showSuccess(response.message || "Пароль змінено");
      showInfo("Виконуємо повторний вхід з новим паролем...");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setFieldErrors({});
      setTimeout(() => {
        logout();
      }, 1200);
    } catch (error) {
      showError((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      const firstError = Object.values(errors)[0];
      if (firstError) showError(firstError);
      return;
    }
    setConfirmOpen(true);
  };

  return (
    <div className="space-y-5">
      <Panel title="Профіль користувача">
        <div className="grid gap-2 text-sm text-slate-700">
          <p>
            Логін: <span className="font-semibold">{user?.username}</span>
          </p>
          <p>
            Ім'я: <span className="font-semibold">{user?.full_name}</span>
          </p>
        </div>
      </Panel>

      <Panel title="Змінити пароль">
        <form className="space-y-3" onSubmit={handleSubmit}>
          <FormField
            label="Поточний пароль"
            required
            helperText="Потрібен для підтвердження зміни"
            errorText={fieldErrors.currentPassword}
          >
            <input
              type="password"
              className={formControlClass}
              value={currentPassword}
              onChange={(event) => {
                setCurrentPassword(event.target.value);
                setFieldErrors((prev) => ({ ...prev, currentPassword: undefined }));
              }}
              maxLength={72}
              required
            />
          </FormField>
          <FormField
            label="Новий пароль"
            required
            helperText="Мінімум 8 символів, максимум 72"
            errorText={fieldErrors.newPassword}
          >
            <input
              type="password"
              className={formControlClass}
              value={newPassword}
              onChange={(event) => {
                setNewPassword(event.target.value);
                setFieldErrors((prev) => ({ ...prev, newPassword: undefined }));
              }}
              minLength={8}
              maxLength={72}
              required
            />
          </FormField>
          <FormField
            label="Підтвердження нового пароля"
            required
            helperText="Повторіть новий пароль"
            errorText={fieldErrors.confirmPassword}
          >
            <input
              type="password"
              className={formControlClass}
              value={confirmPassword}
              onChange={(event) => {
                setConfirmPassword(event.target.value);
                setFieldErrors((prev) => ({ ...prev, confirmPassword: undefined }));
              }}
              minLength={8}
              maxLength={72}
              required
            />
          </FormField>

          <FormSubmitButton
            isLoading={submitting}
            idleLabel="Змінити пароль"
            loadingLabel="Зберігаємо..."
            className="rounded-lg bg-pine px-4 py-2 font-semibold text-white"
          />
          <p className="text-xs text-slate-500">Після зміни пароля ви будете автоматично розлогінені.</p>
        </form>
      </Panel>
      <ConfirmDialog
        open={confirmOpen}
        title="Підтвердження зміни пароля"
        description="Після зміни пароля поточна сесія завершиться і потрібно буде увійти повторно."
        confirmLabel={submitting ? "Зберігаємо..." : "Так, змінити пароль"}
        confirmDisabled={submitting}
        confirmVariant="primary"
        onCancel={() => {
          if (submitting) return;
          setConfirmOpen(false);
        }}
        onConfirm={() => {
          if (submitting) return;
          setConfirmOpen(false);
          submitChange();
        }}
      />
    </div>
  );
}
