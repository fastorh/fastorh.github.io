// ============================================
// 1. FUNCIÓN PARA ENVIAR LA RESEÑA
// ============================================
// Esta función se llama cuando el usuario hace click en "Verificar email y publicar"

async function submitReview(formData) {
  try {
    // formData debe contener:
    // {
    //   nombre: "string",
    //   primer_apellido: "string",
    //   email: "string",
    //   valoracion: number (1-5),
    //   texto: "string"
    // }

    const response = await fetch(
      "https://issrjtjwjzdyruhgzhl.supabase.co/functions/v1/send_review_verification",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlzc3JqeHRqd2p6ZHlydWhnemhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NjM4MjYsImV4cCI6MjA5MzUzOTgyNn0.HyzrftyiRMIRjfnE94fLFGf3QbzBqfKjbdAbQEnt2Is`, // Tu anon key de Supabase
        },
        body: JSON.stringify(formData),
      }
    )

    const data = await response.json()

    if (!response.ok) {
      console.error("Error:", data.error)
      return {
        success: false,
        error: data.error || "Error al enviar la reseña",
      }
    }

    console.log("Reseña enviada exitosamente", data)
    return {
      success: true,
      reviewId: data.reviewId,
      message: data.message,
    }
  } catch (error) {
    console.error("Error submitting review:", error)
    return {
      success: false,
      error: "Error de conexión",
    }
  }
}

// ============================================
// 2. FUNCIÓN PARA VERIFICAR EL CÓDIGO
// ============================================
// Esta función se llama cuando el usuario pega el código que recibió en el email

async function verifyReviewCode(reviewId, code) {
  try {
    // Validar que el código tenga 6 dígitos
    if (!code || code.length !== 6 || isNaN(code)) {
      return {
        success: false,
        error: "El código debe ser de 6 dígitos",
      }
    }

    // Llamar a Supabase para verificar el código
    const { data, error } = await window.supabaseClient
      .from("verification_codes")
      .select("*")
      .eq("code", code)
      .eq("review_id", reviewId)
      .single()

    if (error || !data) {
      console.error("Código inválido o expirado:", error)
      return {
        success: false,
        error: "Código inválido o expirado",
      }
    }

    // Verificar que el código no haya expirado
    const expiresAt = new Date(data.expires_at)
    if (new Date() > expiresAt) {
      return {
        success: false,
        error: "El código ha expirado. Solicita uno nuevo.",
      }
    }

    // Marcar la reseña como verificada
    const { error: updateError } = await window.supabaseClient
      .from("reviews")
      .update({ verified: true })
      .eq("id", reviewId)

    if (updateError) {
      console.error("Error al verificar reseña:", updateError)
      return {
        success: false,
        error: "Error al verificar la reseña",
      }
    }

    // Eliminar el código de verificación (ya no es necesario)
    await window.supabaseClient.from("verification_codes").delete().eq("id", data.id)

    console.log("Reseña verificada exitosamente")
    return {
      success: true,
      message: "¡Reseña publicada exitosamente!",
    }
  } catch (error) {
    console.error("Error verifying code:", error)
    return {
      success: false,
      error: "Error de conexión",
    }
  }
}

// ============================================
// 3. FUNCIÓN PARA OBTENER RESEÑAS VERIFICADAS
// ============================================
// Esta función obtiene solo las reseñas que han sido verificadas

async function getVerifiedReviews() {
  try {
    const { data, error } = await window.supabaseClient
      .from("reviews")
      .select("*")
      .eq("verified", true)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error fetching reviews:", error)
      return {
        success: false,
        error: "Error al cargar las reseñas",
      }
    }

    return {
      success: true,
      reviews: data,
    }
  } catch (error) {
    console.error("Error:", error)
    return {
      success: false,
      error: "Error de conexión",
    }
  }
}

// ============================================
// EJEMPLO DE USO EN TU FORMULARIO
// ============================================

/*
// 1. Cuando el usuario hace click en "Verificar email y publicar"
async function handleSubmitReview(event) {
  event.preventDefault()

  const nombre = document.getElementById("nombre").value
  const primer_apellido = document.getElementById("primer_apellido").value
  const email = document.getElementById("email").value
  const valoracion = parseInt(document.getElementById("valoracion").value)
  const texto = document.getElementById("texto").value

  // Validar campos
  if (!nombre || !primer_apellido || !email || !valoracion || !texto) {
    alert("Por favor completa todos los campos")
    return
  }

  // Mostrar "cargando..."
  const btn = event.target.querySelector("button")
  btn.disabled = true
  btn.textContent = "Enviando..."

  // Enviar reseña
  const result = await submitReview({
    nombre,
    primer_apellido,
    email,
    valoracion,
    texto,
  })

  if (result.success) {
    alert("Se ha enviado un código de verificación a tu email")
    // Guardar el reviewId en variable global o localStorage
    window.currentReviewId = result.reviewId
    // Mostrar modal o campo para pegar el código
    showVerificationCodeInput()
  } else {
    alert("Error: " + result.error)
    btn.disabled = false
    btn.textContent = "Verificar email y publicar"
  }
}

// 2. Cuando el usuario pega el código y hace click para verificar
async function handleVerifyCode(event) {
  event.preventDefault()

  const code = document.getElementById("verification_code").value
  const reviewId = window.currentReviewId

  if (!code || !reviewId) {
    alert("Por favor pega el código")
    return
  }

  const result = await verifyReviewCode(reviewId, code)

  if (result.success) {
    alert(result.message)
    // Recargar las reseñas
    loadReviews()
    // Limpiar formulario
    document.getElementById("review_form").reset()
  } else {
    alert("Error: " + result.error)
  }
}

// 3. Cargar y mostrar las reseñas verificadas
async function loadReviews() {
  const result = await getVerifiedReviews()

  if (result.success) {
    const reviewsContainer = document.getElementById("reviews_container")
    reviewsContainer.innerHTML = ""

    result.reviews.forEach((review) => {
      const reviewEl = document.createElement("div")
      reviewEl.className = "review-item"
      reviewEl.innerHTML = `
        <div class="review-header">
          <strong>${review.nombre} ${review.primer_apellido}</strong>
          <span class="rating">${"⭐".repeat(review.valoracion)}</span>
        </div>
        <p>${review.texto}</p>
        <small>${new Date(review.created_at).toLocaleDateString()}</small>
      `
      reviewsContainer.appendChild(reviewEl)
    })
  }
}

// Cargar reseñas al cargar la página
document.addEventListener("DOMContentLoaded", loadReviews)
*/
