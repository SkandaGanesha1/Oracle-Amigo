import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Check, ImagePlus, RotateCcw, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { OracleAvatar } from "../components/primitives/OracleAvatar";
import { ProfileDetails } from "../features/inspector/ProfileDetails";

const BIO_MAX_LENGTH = 160;

interface AccountProfileDialogProps {
  avatarSeed: string;
  displayName: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}

export function AccountProfileDialog({
  avatarSeed,
  displayName,
  isOpen,
  onOpenChange,
}: AccountProfileDialogProps) {
  const [savedCoverImage, setSavedCoverImage] = useState<string | null>(null);
  const [savedAvatarImage, setSavedAvatarImage] = useState<string | null>(null);
  const [savedBiography, setSavedBiography] = useState("");
  const [coverImage, setCoverImage] = useState<string | null>(savedCoverImage);
  const [avatarImage, setAvatarImage] = useState<string | null>(savedAvatarImage);
  const [biography, setBiography] = useState(savedBiography);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const initials = useMemo(() => initialsFor(displayName), [displayName]);
  const biographyRemaining = BIO_MAX_LENGTH - biography.length;

  useEffect(() => {
    if (isOpen) {
      setCoverImage(savedCoverImage);
      setAvatarImage(savedAvatarImage);
      setBiography(savedBiography);
    }
  }, [isOpen, savedAvatarImage, savedBiography, savedCoverImage]);

  function resetDraft() {
    setCoverImage(savedCoverImage);
    setAvatarImage(savedAvatarImage);
    setBiography(savedBiography);
  }

  function closeWithoutSaving() {
    resetDraft();
    onOpenChange(false);
  }

  function saveDraft() {
    setSavedCoverImage(coverImage);
    setSavedAvatarImage(avatarImage);
    setSavedBiography(biography);
    onOpenChange(false);
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetDraft();
    }
    onOpenChange(nextOpen);
  }

  function handleCoverChange(event: ChangeEvent<HTMLInputElement>) {
    readSelectedImage(event, setCoverImage);
  }

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    readSelectedImage(event, setAvatarImage);
  }

  function handleBiographyChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setBiography(event.currentTarget.value.slice(0, BIO_MAX_LENGTH));
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-label="Account profile dialog"
        className="oa-profile-dialog p-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Profile</DialogTitle>
        <DialogDescription className="sr-only">
          View profile, device, agent, and connection details for the current Oracle Amigo account.
        </DialogDescription>

        <div className="oa-profile-dialog-scroll">
          <ProfileCover
            coverImage={coverImage}
            onChooseImage={() => coverInputRef.current?.click()}
            onRemoveImage={() => setCoverImage(null)}
          />

          <div className="oa-profile-dialog-avatar-row">
            <ProfileAvatar
              avatarImage={avatarImage}
              avatarSeed={avatarSeed}
              displayName={displayName}
              initials={initials}
              onChooseImage={() => avatarInputRef.current?.click()}
            />
            <div className="min-w-0 pt-2">
              <p className="oa-profile-dialog-name">{displayName}</p>
              <p className="oa-profile-dialog-kicker">Oracle Amigo account</p>
            </div>
          </div>

          <div className="oa-profile-dialog-section">
            <label htmlFor="account-profile-biography" className="oa-profile-dialog-label">
              Biography
            </label>
            <Textarea
              id="account-profile-biography"
              value={biography}
              maxLength={BIO_MAX_LENGTH}
              onChange={handleBiographyChange}
              placeholder="Add a short note for this local profile"
              className="oa-profile-dialog-bio"
            />
            <p className="oa-profile-dialog-counter">{biographyRemaining} characters left</p>
          </div>

          <ProfileDetails className="oa-profile-dialog-details" />
        </div>

        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Upload profile cover image"
          onChange={handleCoverChange}
        />
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Upload profile avatar image"
          onChange={handleAvatarChange}
        />

        <DialogFooter className="oa-profile-dialog-footer">
          <Button
            type="button"
            variant="outline"
            className="oa-profile-dialog-secondary"
            onClick={closeWithoutSaving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="oa-profile-dialog-primary"
            onClick={saveDraft}
          >
            <Check className="h-4 w-4" />
            Save changes
          </Button>
        </DialogFooter>

        <button
          type="button"
          className="oa-profile-dialog-close"
          onClick={closeWithoutSaving}
          aria-label="Close profile dialog"
        >
          <X className="h-4 w-4" />
        </button>
      </DialogContent>
    </Dialog>
  );
}

function ProfileCover({
  coverImage,
  onChooseImage,
  onRemoveImage,
}: {
  coverImage: string | null;
  onChooseImage: () => void;
  onRemoveImage: () => void;
}) {
  return (
    <div className="oa-profile-dialog-cover">
      {coverImage ? (
        <img src={coverImage} alt="" className="oa-profile-dialog-cover-image" />
      ) : (
        <div className="oa-profile-dialog-cover-fallback" aria-hidden="true" />
      )}
      <div className="oa-profile-dialog-cover-actions">
        <button
          type="button"
          className="oa-profile-dialog-image-button"
          onClick={onChooseImage}
        >
          <ImagePlus className="h-4 w-4" />
          <span>{coverImage ? "Change" : "Upload"}</span>
        </button>
        {coverImage && (
          <button
            type="button"
            className="oa-profile-dialog-icon-button"
            onClick={onRemoveImage}
            aria-label="Remove profile cover image"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function ProfileAvatar({
  avatarImage,
  avatarSeed,
  displayName,
  initials,
  onChooseImage,
}: {
  avatarImage: string | null;
  avatarSeed: string;
  displayName: string;
  initials: string;
  onChooseImage: () => void;
}) {
  return (
    <div className="oa-profile-dialog-avatar-wrap">
      <div className="oa-profile-dialog-avatar">
        {avatarImage ? (
          <img src={avatarImage} alt={`${displayName} avatar`} className="h-full w-full object-cover" />
        ) : (
          <OracleAvatar
            seed={avatarSeed}
            initials={initials}
            size="lg"
            className="h-full w-full rounded-full"
          />
        )}
      </div>
      <button
        type="button"
        className="oa-profile-dialog-avatar-button"
        onClick={onChooseImage}
        aria-label="Upload profile avatar image"
      >
        <ImagePlus className="h-4 w-4" />
      </button>
    </div>
  );
}

function readSelectedImage(
  event: ChangeEvent<HTMLInputElement>,
  onImageReady: (dataUrl: string) => void
) {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (!file || !file.type.startsWith("image/")) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    if (typeof reader.result === "string") {
      onImageReady(reader.result);
    }
  });
  reader.readAsDataURL(file);
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0] ?? "U").slice(0, 2).toUpperCase();
}
