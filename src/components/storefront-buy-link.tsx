import { sellerConfig } from "@/config/seller";

/** Header and hero link to the public source repository. */
export function SourceLink({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <a href={sellerConfig.repositoryUrl} rel="noreferrer" className={className}>
      {children}
    </a>
  );
}
