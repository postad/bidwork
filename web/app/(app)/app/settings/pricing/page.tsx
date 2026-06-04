import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPricingModel } from "./actions";
import { PricingEditor } from "./PricingEditor";

export default async function PricingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { category, cards } = await getPricingModel();
  return <PricingEditor category={category} cards={cards} />;
}
